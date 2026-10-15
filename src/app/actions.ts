"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser, schoolRegionWhere, scopeToRegion } from "@/lib/auth-helpers";
import { VisitInfo } from "@/lib/types";
// No `format` here on purpose: it renders in the host's zone, and on Vercel
// that is UTC. Day keys and clock times go through @/lib/timezone instead.
import { addDays } from "date-fns";
import { proposeVisitsForWeek } from "@/modules/visitPlanner";
import { proposedVisitToVisitInfo } from "@/lib/visitPlannerAdapter";
import { OpenRouteDistanceService } from "@/modules/visitPlanner";
import type { StartLocationInput } from "@/lib/routing/types";
import {
  optimizeRoute,
  computeRouteForOrder,
} from "@/lib/routing/optimizeRoute";
import { geocodeAddress, getDrivingPolyline } from "@/lib/routing/openRouteClient";
import { getCachedTravelMatrix } from "@/lib/routing/cachedDistanceMatrix";
import { decimalToNumber } from "@/lib/decimal";
import { activeRulesBySchool, cadenceStart, cadenceStatus, lastContactBySchool } from "@/lib/cadence";
import { isAfterschoolClass } from "@/lib/afterschool";
import {
  OVERSIGHT_ROLES,
  canAdministerApp,
  canChangeSchoolStatus,
  canEditOthersVisits,
  canFilterByRegion,
  canManageSchoolData,
  canPlanVisits,
  canSeeOthersReports,
  programmeScopeFor,
  seesAllRegions,
  workWindowFor,
} from "@/lib/permissions";
import { syncDatasetToSheet } from "@/lib/export/syncSheet";
import { haversineMeters } from "@/lib/geo";
import { syncWeekToCalendar } from "@/lib/google/personalCalendar";
import { pullClassesFromYmua } from "@/lib/ymuaClassFeed";
import { syncEvaluationToYmua } from "@/lib/evaluationRelay";
import { after } from "next/server";
import {
  APP_TIME_ZONE,
  dayKeyInAppZone,
  formatTimeInAppZone,
  addDaysToDayKey,
  mondayOfDayKey,
  toAppZoneDayKey,
  zonedDayStart,
} from "@/lib/timezone";
import {
  hasPinOnDay,
  resolveOverrides,
  splitDayScope,
  type Pin,
} from "@/lib/plannerOverrides";
import { getMileageReportData } from "@/lib/reports/mileageReport";
import { resolveRange, type RangePreset } from "@/lib/reports/reportRange";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

/** Prisma's Decimal isn't plain-serializable across the server/client boundary. */
function serializeVisit<T extends { milesDriven: unknown }>(visit: T) {
  return { ...visit, milesDriven: decimalToNumber(visit.milesDriven) };
}

export async function getRegions() {
  return await prisma.region.findMany({ orderBy: { name: "asc" } });
}

export async function getDashboardStats(regionFilter?: string | null) {
  const session = await auth();
  const user = requireUser(session);
  const baseWhere = schoolRegionWhere(user);
  const regionWhere =
    canFilterByRegion(user.role) && regionFilter
      ? { regionId: regionFilter }
      : baseWhere;

  // The office is a stop, not a school to be visited on a schedule — counting it
  // here would inflate coverage against a target it was never part of. Schools
  // on hold or inactive (#64) are not counted either: nothing to visit there.
  const schoolsOnly = { ...regionWhere, active: true, isOffice: false, status: "ACTIVE" as const };

  const totalSchools = await prisma.school.count({ where: schoolsOnly });

  // Coverage means "has the region that owns this school been to it". Another
  // region's RM dropping in is real work, but it doesn't cover the school for
  // whoever is responsible for it — the same rule the planner's cadence uses,
  // and without it the two disagree about whether a school has been seen.
  const visitCounts = await prisma.visit.groupBy({
    by: ["schoolId"],
    where: {
      status: "DONE",
      school: schoolsOnly,
      ...(regionWhere.regionId !== undefined
        ? { OR: [{ visitedBy: { regionId: regionWhere.regionId } }, { visitedById: null }] }
        : {}),
    },
    _count: { id: true },
  });

  const schools = await prisma.school.findMany({
    where: schoolsOnly,
    select: { id: true, name: true, activeSince: true },
  });

  // By class, not only by school (Emilio, 2026-10-15): which programmes those
  // visits actually watched — one visit to Carol City that observed Drumline
  // and Band at once counts once for the school and once for each class.
  const observedRows = await prisma.visitObservation.findMany({
    where: {
      visit: {
        status: "DONE",
        school: schoolsOnly,
        ...(regionWhere.regionId !== undefined
          ? { OR: [{ visitedBy: { regionId: regionWhere.regionId } }, { visitedById: null }] }
          : {}),
      },
    },
    select: { visit: { select: { schoolId: true } }, subject: { select: { name: true } } },
  });
  const observedBySchool = new Map<string, Map<string, number>>();
  for (const row of observedRows) {
    const name = row.subject?.name ?? "Class not recorded";
    const perSchool = observedBySchool.get(row.visit.schoolId) ?? new Map<string, number>();
    perSchool.set(name, (perSchool.get(name) ?? 0) + 1);
    observedBySchool.set(row.visit.schoolId, perSchool);
  }

  const visitedSchoolsList = schools
    .map((school) => {
      const vc = visitCounts.find((v) => v.schoolId === school.id);
      const classes = [...(observedBySchool.get(school.id) ?? new Map<string, number>())]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return { id: school.id, name: school.name, visitCount: vc ? vc._count.id : 0, classes };
    })
    .sort((a, b) => b.visitCount - a.visitCount);

  // ─── Cadence: due, overdue, never seen ────────────────────────────────────
  //
  // These three were placeholders — dueThisWeek was literally
  // Math.floor(totalSchools / 3), and the other two were hardcoded zeros. A
  // made-up number on a dashboard is worse than an empty one: it gets believed,
  // and it gets planned around.
  //
  // Computed here from the same helpers the weekly planner proposes from
  // (src/lib/cadence.ts), so the dashboard and the planner cannot tell a
  // Regional Manager two different stories about the same school.
  const [visitRules, doneVisitsForCadence] = await Promise.all([
    prisma.visitRule.findMany({
      where: { school: schoolsOnly },
      orderBy: { createdAt: "desc" },
    }),
    prisma.visit.findMany({
      where: { status: "DONE", school: schoolsOnly },
      orderBy: { plannedStartDateTime: "desc" },
      select: {
        schoolId: true,
        plannedStartDateTime: true,
        mode: true,
        school: { select: { regionId: true } },
        visitedBy: { select: { regionId: true } },
      },
    }),
  ]);

  const activeRules = activeRulesBySchool(visitRules);
  const { lastInPerson } = lastContactBySchool(doneVisitsForCadence);

  // Miami's today and Miami's week, not the host's — a server in UTC is already
  // tomorrow by 8pm here, which would move a school from "due Friday" to
  // "overdue" a day early.
  const todayKey = dayKeyInAppZone(new Date());
  const today = zonedDayStart(todayKey);
  const weekStart = zonedDayStart(mondayOfDayKey(todayKey));
  const weekEnd = addDays(weekStart, 7);

  // The schools behind each number, not only the count (FR-038, Carlos Fabre:
  // "Overdue: 7" says there is work and not which work). Day keys rather than
  // Dates so the client prints Miami's calendar day, not its own.
  const overdueSchools: { id: string; name: string; lastVisitKey: string; daysLate: number }[] = [];
  const dueSchools: { id: string; name: string; dueKey: string }[] = [];
  const neverVisitedSchools: { id: string; name: string }[] = [];

  for (const school of schools) {
    // Counted from the day it came back from a hold, if that is later (#64).
    const last = cadenceStart(lastInPerson.get(school.id), school.activeSince);
    const status = cadenceStatus(last, activeRules.get(school.id)?.frequencyType, today);
    if (status.neverVisited) {
      // Counted apart from overdue on purpose: "twelve schools nobody has ever
      // walked into" and "one school is three days late" are different jobs.
      neverVisitedSchools.push({ id: school.id, name: school.name });
    } else if (status.isOverdue) {
      overdueSchools.push({
        id: school.id,
        name: school.name,
        lastVisitKey: dayKeyInAppZone(last!),
        daysLate: (status.daysSinceLast ?? 0) - status.freqDays,
      });
    } else if (status.dueDate && status.dueDate < weekEnd) {
      // Falls due before this week is out, and is not late yet.
      dueSchools.push({ id: school.id, name: school.name, dueKey: dayKeyInAppZone(status.dueDate) });
    }
  }

  // The classes each listed school teaches (next four weeks), so a list reads
  // "Carol City MS · Drumline, Beginning Band" rather than a bare school name.
  const listedIds = [...overdueSchools, ...dueSchools, ...neverVisitedSchools].map((s) => s.id);
  const upcoming = listedIds.length
    ? await prisma.classSession.findMany({
        where: { schoolId: { in: listedIds }, startDateTime: { gte: today, lt: addDays(today, 28) } },
        select: { schoolId: true, subject: { select: { name: true } } },
        distinct: ["schoolId", "subjectId"],
      })
    : [];
  const classesBySchool: Record<string, string[]> = {};
  for (const row of upcoming) {
    if (!row.subject?.name) continue;
    (classesBySchool[row.schoolId] ??= []).push(row.subject.name);
  }
  for (const list of Object.values(classesBySchool)) list.sort();

  // Most urgent first: the latest overdue, the soonest due.
  overdueSchools.sort((a, b) => b.daysLate - a.daysLate || a.name.localeCompare(b.name));
  dueSchools.sort((a, b) => a.dueKey.localeCompare(b.dueKey) || a.name.localeCompare(b.name));
  neverVisitedSchools.sort((a, b) => a.name.localeCompare(b.name));

  // ─── Cancellations reported from the field ────────────────────────────────
  //
  // Not calendar cancellations: this is what the RM said happened when they got
  // there, recorded as the reason the classroom rubric came back blank. That is
  // the only place in the app anybody writes "they cancelled the class on me",
  // so it is the only honest source for this number.
  const CANCELLATION_WINDOW_DAYS = 30;
  const recentCancellations = await prisma.visit.count({
    where: {
      status: "DONE",
      obsSkipReason: "CLASS_CANCELLED",
      plannedStartDateTime: { gte: addDays(today, -CANCELLATION_WINDOW_DAYS) },
      ...(canFilterByRegion(user.role) && regionFilter
        ? { school: { regionId: regionFilter } }
        : { visitedById: user.id }),
    },
  });

  // ─── This week's own work ─────────────────────────────────────────────────
  //
  // Visits, not schools: going back to the same school twice in a week is two
  // visits, and an RM counting up their week means the second one too. The
  // office is excluded — it is a stop on a route, not a school anybody is
  // covering. Split by mode because a phone call and a morning at the school
  // are not the same thing, which is the whole reason mode exists.
  // An Admin filtering to a region wants that region's work; everyone else
  // means their own. Composed as one object rather than spread over a `school`
  // key that is already set — that silently drops the isOffice filter.
  const weekScope =
    canFilterByRegion(user.role) && regionFilter
      ? { school: { isOffice: false, regionId: regionFilter } }
      : { school: { isOffice: false }, visitedById: user.id };

  const weekVisits = await prisma.visit.groupBy({
    by: ["mode"],
    where: {
      status: "DONE",
      plannedStartDateTime: { gte: weekStart, lt: weekEnd },
      ...weekScope,
    },
    _count: { _all: true },
  });

  const countFor = (mode: string) =>
    weekVisits.find((w) => w.mode === mode)?._count._all ?? 0;

  const thisWeek = {
    inPerson: countFor("IN_PERSON"),
    online: countFor("ONLINE"),
    phone: countFor("PHONE"),
    total: weekVisits.reduce((sum, w) => sum + w._count._all, 0),
  };

  // ─── On hold, and schools that look like they should be (#64) ─────────────
  const statusScope = { ...regionWhere, active: true, isOffice: false };
  const HOLD_LOOKBACK_DAYS = 21;
  const HOLD_LOOKAHEAD_DAYS = 28;
  const [onHoldRows, noClassRows, resumeRows] = await Promise.all([
    prisma.school.findMany({
      where: { ...statusScope, status: "ON_HOLD" },
      select: { id: true, name: true, regionId: true, statusReason: true, statusChangedAt: true },
      orderBy: { name: "asc" },
    }),
    // Active, and not one class in the calendar three weeks back or four ahead.
    prisma.school.findMany({
      where: {
        ...statusScope,
        status: "ACTIVE",
        classSessions: {
          none: { startDateTime: { gte: addDays(today, -HOLD_LOOKBACK_DAYS), lt: addDays(today, HOLD_LOOKAHEAD_DAYS) } },
        },
        OR: [{ holdSuggestionSnoozedUntil: null }, { holdSuggestionSnoozedUntil: { lt: new Date() } }],
      },
      select: { id: true, name: true, regionId: true },
      orderBy: { name: "asc" },
    }),
    // On hold, but classes are on the calendar again in the next two weeks.
    prisma.school.findMany({
      where: {
        ...statusScope,
        status: "ON_HOLD",
        classSessions: { some: { startDateTime: { gte: today, lt: addDays(today, 14) } } },
      },
      select: { id: true },
    }),
  ]);
  const resumeIds = new Set(resumeRows.map((r) => r.id));
  const onHoldSchools = onHoldRows.map((r) => ({
    id: r.id,
    name: r.name,
    reason: r.statusReason,
    sinceKey: r.statusChangedAt ? dayKeyInAppZone(r.statusChangedAt) : null,
    hasClassesAgain: resumeIds.has(r.id),
    canChange: canChangeSchoolStatus(user, r),
  }));
  const holdSuggestions = noClassRows.map((r) => ({
    id: r.id,
    name: r.name,
    canChange: canChangeSchoolStatus(user, r),
  }));

  return {
    totalActiveSchools: totalSchools,
    onHoldSchools,
    holdSuggestions,
    holdSuggestionWeeks: { back: HOLD_LOOKBACK_DAYS / 7, ahead: HOLD_LOOKAHEAD_DAYS / 7 },
    dueThisWeek: dueSchools.length,
    overdue: overdueSchools.length,
    neverVisited: neverVisitedSchools.length,
    overdueSchools,
    dueSchools,
    neverVisitedSchools,
    classesBySchool,
    recentCancellations,
    cancellationWindowDays: CANCELLATION_WINDOW_DAYS,
    thisWeek,
    visitedSchoolsList,
  };
}

/**
 * Schools for pickers, lists and the map. ON_HOLD schools are included — a
 * visit can still be logged there, and the lists grey them — but INACTIVE ones
 * (#64: no longer ours, or closed) only when asked for, by the school list
 * that is where they are brought back from.
 */
export async function getSchools(regionFilter?: string | null, options: { includeInactive?: boolean } = {}) {
  const session = await auth();
  const user = requireUser(session);
  const baseWhere = schoolRegionWhere(user);
  const regionWhere =
    canFilterByRegion(user.role) && regionFilter
      ? { regionId: regionFilter }
      : baseWhere;

  return await prisma.school.findMany({
    where: {
      ...regionWhere,
      active: true,
      isOffice: false,
      ...(options.includeInactive ? {} : { status: { not: "INACTIVE" as const } }),
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Active schools that sit OUTSIDE the caller's own region, for the "Other region
 * school" picker when logging a visit manually (a mentor covering elsewhere).
 *
 * Returns [] for ADMINs — they aren't scoped to a region, so `getSchools` already
 * lists every school and nothing counts as "other".
 *
 * Schools with no region at all are grouped under "Unassigned". The null branch is
 * spelled out because Prisma's `{ not: x }` on a nullable column does not reliably
 * mean "including NULLs" across versions.
 */
export async function getOtherRegionSchools() {
  const session = await auth();
  const user = requireUser(session);
  const ownRegionId = scopeToRegion(user);

  if (ownRegionId === undefined) return [];

  const schools = await prisma.school.findMany({
    where: {
      active: true,
      isOffice: false,
      status: { not: "INACTIVE" },
      OR: [{ regionId: { not: ownRegionId } }, { regionId: null }],
    },
    select: { id: true, name: true, region: { select: { name: true } } },
    orderBy: [{ region: { name: "asc" } }, { name: "asc" }],
  });

  return schools.map((s) => ({
    id: s.id,
    name: s.name,
    regionName: s.region?.name ?? "Unassigned",
  }));
}

/**
 * The YMU office(s), for the origin picker, the end-of-day destination and the
 * manual form's stop list. Empty when none has been seeded, which every caller
 * treats as "just don't offer the option".
 */
export async function getOfficeLocations() {
  const session = await auth();
  requireUser(session);

  const offices = await prisma.school.findMany({
    where: { isOffice: true, active: true },
    select: { id: true, name: true, address: true, lat: true, lng: true },
    orderBy: { name: "asc" },
  });
  return offices.filter((o) => o.lat != null && o.lng != null);
}

/**
 * The school's coordinates, straight from the database.
 *
 * The confirm modal used to trust whatever lat/lng the plan item carried, and
 * a plan item can arrive without them — from a pinned visit, from a plan
 * rehydrated out of localStorage by an older build, from any future code that
 * builds a VisitInfo and forgets. The result was a modal announcing "this
 * school has no saved location" about a school whose address has been on file
 * all along, which reads as broken data and undermines every mileage figure
 * the app reports.
 *
 * So the geofence asks the server. There is one authority for where a school
 * is, and it is this row.
 */
export async function getSchoolLocation(schoolId: string) {
  const session = await auth();
  requireUser(session);

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { lat: true, lng: true },
  });
  if (!school || school.lat == null || school.lng == null) return null;
  return { lat: school.lat, lng: school.lng };
}

/**
 * Turns pins into finished plan rows.
 *
 * Shared by getWeeklyPlan and getManualVisit so that a visit added by hand is
 * the same card either way — carrying the school's coordinates (without them
 * the confirm screen has no geofence target), and the programme and teacher
 * from the class it was booked against, rather than arriving as a bare row
 * reading "Pinned manually" with no subject and nobody to rate.
 */
async function buildPinnedVisits(pins: Pin[], weekKey: string): Promise<VisitInfo[]> {
  if (pins.length === 0) return [];

  const weekStart = zonedDayStart(weekKey);
  const schoolIds = [...new Set(pins.map((p) => p.schoolId))];
  const [schools, sessions, rules] = await Promise.all([
    prisma.school.findMany({ where: { id: { in: schoolIds } } }),
    prisma.classSession.findMany({
      where: {
        schoolId: { in: schoolIds },
        startDateTime: { gte: weekStart },
        endDateTime: { lt: zonedDayStart(addDaysToDayKey(weekKey, 5)) },
      },
      include: { subject: true, teacher: true },
    }),
    prisma.visitRule.findMany({
      where: { schoolId: { in: schoolIds } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const schoolById = new Map(schools.map((s) => [s.id, s]));
  const ruleBySchool = activeRulesBySchool(rules);
  // Matched on the class's own start time, which is exactly what both the "Add"
  // and the "Postpone" pickers hand back as the pin's startTime.
  const sessionByKey = new Map(
    sessions.map((s) => [
      `${s.schoolId}:${dayKeyInAppZone(s.startDateTime)}:${formatTimeInAppZone(s.startDateTime)}`,
      s,
    ])
  );

  const rows: VisitInfo[] = [];
  for (const pin of pins) {
    const school = schoolById.get(pin.schoolId);
    if (!school) continue;

    const classSession = sessionByKey.get(`${pin.schoolId}:${pin.dayKey}:${pin.startTime}`);
    const rule = ruleBySchool.get(pin.schoolId);

    rows.push({
      schoolId: school.id,
      schoolName: school.name,
      zipCode: school.zipCode,
      lat: school.lat ?? undefined,
      lng: school.lng ?? undefined,
      // The class's own instant where there is one, so the card lands in the
      // right day column and the confirmation files it under the right day.
      // The override itself only ever carried a nominal midday timestamp.
      date: classSession?.startDateTime ?? instantInAppZone(pin.dayKey, pin.startTime),
      score: 1000,
      reason: "Added by hand",
      startTime: pin.startTime,
      endTime: pin.endTime,
      classStartTime: classSession ? formatTimeInAppZone(classSession.startDateTime) : undefined,
      classEndTime: classSession ? formatTimeInAppZone(classSession.endDateTime) : undefined,
      subjectName: classSession?.subject?.name,
      subjectId: classSession?.subject?.id,
      // Only a teacher imported from YMU-A; a leftover calendar row is a school
      // name, not a person to attribute a rating to.
      teacherId: classSession?.teacher?.externalId ? classSession.teacher.id : undefined,
      teacherName: classSession?.teacher?.externalId ? classSession.teacher.name : undefined,
      // No class at that hour means this is the admin / catch-up visit the Add
      // dialog offers when a school teaches nothing this week — worth saying on
      // the card rather than leaving it looking like a normal observation.
      noClassWarning: !classSession,
      visitRuleFrequency: rule ? rule.frequencyType : "DEFAULT",
      visitRuleNote: rule?.reason ?? undefined,
      isPinned: true,
      isCompleted: false,
      viableOptionsThisWeek: [],
    });
  }
  return rows;
}

/**
 * The instant a wall-clock "HH:mm" falls at on a Miami calendar day.
 *
 * Used for a hand-placed visit that has no class session to borrow an instant
 * from. Building it with `new Date(`${dayKey}T${time}`)` would read the host's
 * zone, which on Vercel put a 09:00 admin visit at 05:00 Miami — the same bug
 * the planner's own no-class slot had.
 */
function instantInAppZone(dayKey: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(zonedDayStart(dayKey).getTime() + ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
}

export async function getWeeklyPlan(
  weekStartDateIso: string,
  manualOverrides: Partial<VisitInfo>[] = [],
  maxVisitsPerWeek: number = 12,
  maxVisitsPerDay: number = 4,
  regionFilter?: string | null
): Promise<VisitInfo[]> {
  const session = await auth();
  const user = requireUser(session);

  // Determine the effective regionId: RMs use their own region, Admins may filter
  const regionId: string | undefined =
    canFilterByRegion(user.role) && regionFilter
      ? regionFilter
      : user.regionId ?? undefined;

  // Accepts either a "yyyy-MM-dd" week key or, from an older client, a full
  // ISO instant — both resolved to a Miami calendar day before picking the week,
  // so the host's zone never decides which Monday was meant.
  const weekKey = mondayOfDayKey(toAppZoneDayKey(weekStartDateIso));
  const weekStart = zonedDayStart(weekKey);
  const weekDayKeys = Array.from({ length: 5 }, (_, i) => addDaysToDayKey(weekKey, i));
  const weekDayKeySet = new Set(weekDayKeys);

  // ---------------------------------------------------------------------------
  // The user's manual decisions, resolved BEFORE the plan is built.
  //
  // These used to be applied to the finished plan: propose a whole week, then
  // filter the skips out of it and staple the pins on. That is the root of
  // "every time I add something by hand it reshuffles everything". A skipped
  // stop had already taken its turn in the clustering and spent a slot of the
  // weekly budget, so deleting a visit shrank the week; a pinned stop was
  // invisible to the optimiser, which then evicted whatever it had proposed
  // for that school somewhere else and re-clustered the rest of the week
  // around the hole. Both are now inputs to proposeVisitsForWeek.
  //
  // How a contradictory pair of overrides is read lives in
  // @/lib/plannerOverrides, shared with the store so the screen and the server
  // agree about what the user has decided.
  // ---------------------------------------------------------------------------

  const { pins, skippedDays } = resolveOverrides(manualOverrides, weekDayKeySet);

  // Skips recorded in the database on earlier visits to this screen. Scoped to
  // the region like the completed-visit overlay below: a school is one region's
  // to cover, and another manager skipping it is not this manager's decision.
  const skippedInDb = await prisma.visit.findMany({
    where: {
      status: "SKIPPED",
      plannedStartDateTime: { gte: weekStart, lt: addDays(weekStart, 5) },
      ...(regionId ? { school: { regionId } } : {}),
    },
    select: { schoolId: true, plannedStartDateTime: true },
  });
  for (const skip of skippedInDb) {
    const dayScope = `${skip.schoolId}:${dayKeyInAppZone(skip.plannedStartDateTime)}`;
    // Unless it has since been pinned back onto that day. The skip row stays in
    // the database once written, so without this a school could never be put
    // back on a day it had once been taken off.
    if (!hasPinOnDay(pins, dayScope)) skippedDays.add(dayScope);
  }

  // Built before the plan, because the optimiser needs their coordinates and
  // their windows to route each day around them.
  const pinnedRows = await buildPinnedVisits(pins, weekKey);
  const pinnedCoords = new Map(pinnedRows.map((r) => [r.schoolId, { lat: r.lat, lng: r.lng }]));

  const distanceService =
    process.env.OPENROUTE_SERVICE_API_KEY ? new OpenRouteDistanceService() : undefined;

  const proposed = await proposeVisitsForWeek(prisma, weekStart, {
    regionId,
    // The Afterschool Manager plans afterschool across every region; everyone
    // else plans the school day. Before this the filter was hardcoded to
    // exclude afterschool, so that role's planner would have been empty — the
    // 23 sessions it exists to cover were the only ones being dropped.
    programmes: programmeScopeFor(user),
    // An afterschool class is out of hours by definition, so it needs a working
    // day that reaches past 17:00 — see workWindowFor().
    workWindow: workWindowFor(user),
    maxVisitsPerWeek,
    maxVisitsPerDay,
    distanceService,
    // What the user has already decided. Given to the planner rather than
    // applied to its output — see the block above.
    pinned: pins.map((pin) => ({
      schoolId: pin.schoolId,
      dayKey: pin.dayKey,
      startTime: pin.startTime,
      endTime: pin.endTime,
      lat: pinnedCoords.get(pin.schoolId)?.lat ?? null,
      lng: pinnedCoords.get(pin.schoolId)?.lng ?? null,
    })),
    skipped: [...skippedDays].map(splitDayScope),
  });

  const plan: VisitInfo[] = proposed.map(proposedVisitToVisitInfo);

  // No filtering or eviction is needed here any more: the planner was told
  // about these, so it has already left their schools out of its own picks and
  // built each day's route around them.
  plan.push(...pinnedRows);

  // Overlay completed visits from DB
  const visitsDoneWeek = await prisma.visit.findMany({
    where: {
      status: "DONE",
      plannedStartDateTime: { gte: weekStart, lt: addDays(weekStart, 5) },
      ...(regionId ? { school: { regionId } } : {}),
    },
    include: { school: true },
  });
  // Which plan rows a completed visit has already claimed. Matching on school
  // and day alone collapsed two visits to the same school on the same day onto
  // one row — Horace Mann's two Music Production classes — so confirming both
  // made one of them vanish from the week.
  const claimedByDone = new Set<number>();
  for (const v of visitsDoneWeek) {
    const d = v.plannedStartDateTime;
    const sameSchoolAndDay = (p: VisitInfo) =>
      p.schoolId === v.schoolId && dayKeyInAppZone(p.date) === dayKeyInAppZone(d);
    // Prefer the row for this very slot; fall back to any unclaimed row for the
    // school that day, which is what a confirmation off a proposed card looks
    // like once the server has re-stamped it with the day's next route slot.
    let idx = plan.findIndex(
      (p, i) =>
        !claimedByDone.has(i) &&
        sameSchoolAndDay(p) &&
        p.startTime === formatTimeInAppZone(d)
    );
    if (idx < 0) {
      idx = plan.findIndex((p, i) => !claimedByDone.has(i) && sameSchoolAndDay(p));
    }
    if (idx >= 0) claimedByDone.add(idx);
    const completed: VisitInfo = {
      schoolId: v.schoolId,
      schoolName: v.school.name,
      zipCode: v.school.zipCode,
      lat: v.school.lat ?? undefined,
      lng: v.school.lng ?? undefined,
      date: d,
      score: 0,
      reason: v.reason ?? "Completed",
      startTime: "Done",
      endTime: "Done",
      isPinned: false,
      isCompleted: true,
    };
    if (idx >= 0) plan[idx] = completed;
    else plan.push(completed);
  }

  // Populate viableOptionsThisWeek for each school in the plan
  const schoolIdsInPlan = [...new Set(plan.map((v) => v.schoolId))];
  const optionsBySchool = await Promise.all(
    schoolIdsInPlan.map((schoolId) =>
      getSchoolCalendarOptionsForWeek(schoolId, weekStart.toISOString())
    )
  );
  const optionsBySchoolMap = new Map(
    schoolIdsInPlan.map((id, i) => [id, optionsBySchool[i] ?? []])
  );
  for (const v of plan) {
    v.viableOptionsThisWeek = optionsBySchoolMap.get(v.schoolId) ?? [];
  }

  plan.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (da !== db) return da - db;
    if (a.isCompleted) return -1;
    if (b.isCompleted) return 1;
    const timeA = (a.startTime ?? "00:00") === "Done" ? 9999 : parseInt(a.startTime!.replace(":", ""), 10);
    const timeB = (b.startTime ?? "00:00") === "Done" ? 9999 : parseInt(b.startTime!.replace(":", ""), 10);
    return timeA - timeB;
  });

  return plan;
}

/**
 * One hand-placed visit, as a finished plan row, without touching the rest of
 * the week.
 *
 * The Add dialog used to recalculate the whole week after every addition, and
 * that is why adding one school could move four others: the optimiser reruns
 * from scratch, and any change to its inputs re-clusters the days. Placing a
 * visit is not a reason to re-plan the week the user has already accepted — so
 * the planner asks for the one card and inserts it.
 */
export async function getManualVisit(
  schoolId: string,
  dayKey: string,
  startTime: string,
  endTime: string
): Promise<VisitInfo | null> {
  const session = await auth();
  const user = requireUser(session);
  // Same rule as every other write on this screen: an oversight role reads the
  // plan and does not change it.
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role cannot change visits");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error("dayKey must be yyyy-MM-dd");
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error("startTime and endTime must be HH:mm");
  }

  // Scoped like getSchools, so this cannot be used to place a visit on a school
  // outside the caller's own region.
  const school = await prisma.school.findFirst({
    where: { id: schoolId, active: true, isOffice: false, status: { not: "INACTIVE" }, ...schoolRegionWhere(user) },
    select: { id: true },
  });
  if (!school) return null;

  const weekKey = mondayOfDayKey(dayKey);
  const [row] = await buildPinnedVisits([{ schoolId, dayKey, startTime, endTime }], weekKey);
  if (!row) return null;

  row.viableOptionsThisWeek = await getSchoolCalendarOptionsForWeek(
    schoolId,
    zonedDayStart(weekKey).toISOString()
  );
  return row;
}

export async function getSchoolOptionsForWeek(
  schoolId: string,
  weekStartDateIso: string
): Promise<import("@/lib/types").ViableOption[]> {
  const session = await auth();
  const user = requireUser(session);

  // Same Miami-anchored week as getWeeklyPlan, so the two can't disagree about
  // which days the week covers.
  const weekKey = mondayOfDayKey(toAppZoneDayKey(weekStartDateIso));
  const start = zonedDayStart(weekKey);
  const weekEnd = zonedDayStart(addDaysToDayKey(weekKey, 5));

  type ViableOption = import("@/lib/types").ViableOption;
  const seen = new Set<string>();
  const merged: ViableOption[] = [];
  const addOption = (opt: ViableOption) => {
    // The class name is part of what makes two options the same slot, not
    // just the date and time — Young Men's Prep runs Modern Band and Drumline
    // back to back at the identical Mon/Wed/Thu 12:40-14:10 window, and
    // keying on time alone silently dropped whichever one wasn't seen first.
    const key = `${opt.date}-${opt.rule.start}-${opt.rule.end}-${opt.rule.class ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(opt);
  };

  const sessions = await prisma.classSession.findMany({
    where: { schoolId, startDateTime: { gte: start }, endDateTime: { lt: weekEnd } },
    include: { subject: true },
  });
  // Whose programme this viewer runs. Same rule as the planner: an RM never
  // wants the afterschool slots, the Afterschool Manager wants nothing else,
  // and the one RM who runs a programme of his own wants both.
  const scope = programmeScopeFor(user);
  for (const s of sessions) {
    if (scope !== "all" && isAfterschoolClass(s.subject?.name, s.startDateTime) !== (scope === "only-afterschool")) {
      continue;
    }
    addOption({
      date: dayKeyInAppZone(s.startDateTime),
      rule: {
        start: formatTimeInAppZone(s.startDateTime),
        end: formatTimeInAppZone(s.endDateTime),
        class: s.subject.name,
      },
    });
  }

  // School.availability, a hand-kept blob, used to be consulted here as a
  // fallback. It goes stale the moment the real calendar changes — Edison
  // Park's still claimed a Wednesday Modern Band/Drum Line slot the calendar
  // had long since dropped, so "Add a visit" offered a class that didn't
  // exist instead of falling through to the no-class/admin-visit message.
  // The calendar is the only source of truth now, same as
  // getSchoolCalendarOptionsForWeek and getSchoolWeeklySchedules.
  return merged;
}

export async function getSchoolCalendarOptionsForWeek(
  schoolId: string,
  weekStartDateIso: string
): Promise<import("@/lib/types").ViableOption[]> {
  const session = await auth();
  const user = requireUser(session);

  // Same Miami-anchored week as getWeeklyPlan, so the two can't disagree about
  // which days the week covers.
  const weekKey = mondayOfDayKey(toAppZoneDayKey(weekStartDateIso));
  const start = zonedDayStart(weekKey);
  const weekEnd = zonedDayStart(addDaysToDayKey(weekKey, 5));

  const sessions = await prisma.classSession.findMany({
    where: { schoolId, startDateTime: { gte: start }, endDateTime: { lt: weekEnd } },
    include: { subject: true },
    orderBy: { startDateTime: "asc" },
  });

  const scope = programmeScopeFor(user);
  return sessions
    .filter(
      (s) =>
        scope === "all" ||
        isAfterschoolClass(s.subject?.name, s.startDateTime) === (scope === "only-afterschool")
    )
    .map((s) => ({
      date: dayKeyInAppZone(s.startDateTime),
      rule: {
        start: formatTimeInAppZone(s.startDateTime),
        end: formatTimeInAppZone(s.endDateTime),
        class: s.subject.name,
      },
    }));
}


const originCoordsSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().optional(),
  /**
   * Set when the RM started from home. That first leg is commute under the IRS
   * rule and isn't reimbursed. Sent explicitly rather than inferred from the
   * label, which is free text and would break the moment it was reworded.
   */
  isHome: z.boolean().optional(),
});

const observationRatingSchema = z.enum(["NEEDS_SUPPORT", "DEVELOPING", "MEETS", "EXCEEDS"]);

const observationSkipReasonSchema = z.enum([
  "DID_NOT_STAY",
  "NO_CLASS_TODAY",
  "CLASS_CANCELLED",
  "TEACHER_ABSENT",
  "SCHEDULE_CONFLICT",
  "OTHER",
]);

/**
 * One class the RM watched, as the visit forms send it.
 *
 * A visit used to carry exactly one of these as columns on Visit. Carol City
 * MS and North Dade run two classes at the same time in the same building, and
 * the RM who watched both could rate only one (Eric Levy, 2026-10-15) — so the
 * forms now send a list, one entry per class ticked, each with its own ratings
 * and notes.
 *
 * `id` is only ever sent back for an observation already saved. It is what
 * YMU-A keys the teacher's evaluation by, so an edit that keeps a class must
 * keep its id; see replaceVisitObservations.
 */
const observationInputSchema = z.object({
  id: z.string().optional(),
  teacherId: z.string().nullable().optional(),
  subjectId: z.string().nullable().optional(),
  obsPlanningPrep: observationRatingSchema.nullable().optional(),
  obsCultureManagement: observationRatingSchema.nullable().optional(),
  obsInstructionMusicianship: observationRatingSchema.nullable().optional(),
  obsEngagementEvidence: observationRatingSchema.nullable().optional(),
  obsProfessionalismGrowth: observationRatingSchema.nullable().optional(),
  notes: z.string().max(2000).optional(),
});
type ObservationInput = z.infer<typeof observationInputSchema>;

// More classes than run side by side anywhere YMU teaches. A cap so a broken
// client cannot write a hundred rows into one visit, not a product rule.
const observationsSchema = z.array(observationInputSchema).max(6);

/**
 * The single-observation fields every form sent before a visit could hold
 * several. Still accepted: a phone with a cached older bundle keeps posting
 * these, and refusing them would fail that RM's save outright. They are turned
 * into a one-element list (legacyObservation) and never written as columns.
 */
const legacyObservationFields = {
  observedTeacherId: z.string().nullable().optional(),
  observedSubjectId: z.string().nullable().optional(),
  obsPlanningPrep: observationRatingSchema.nullable().optional(),
  obsCultureManagement: observationRatingSchema.nullable().optional(),
  obsInstructionMusicianship: observationRatingSchema.nullable().optional(),
  obsEngagementEvidence: observationRatingSchema.nullable().optional(),
  obsProfessionalismGrowth: observationRatingSchema.nullable().optional(),
  obsNotes: z.string().max(2000).optional(),
};
type LegacyObservationFields = {
  [K in keyof typeof legacyObservationFields]?: z.infer<(typeof legacyObservationFields)[K]>;
};

const RATING_KEYS = [
  "obsPlanningPrep",
  "obsCultureManagement",
  "obsInstructionMusicianship",
  "obsEngagementEvidence",
  "obsProfessionalismGrowth",
] as const;

/** An older client's single observation as a list entry, or null if it sent none. */
function legacyObservation(data: LegacyObservationFields): ObservationInput | null {
  const o: ObservationInput = {
    teacherId: data.observedTeacherId ?? null,
    subjectId: data.observedSubjectId ?? null,
    obsPlanningPrep: data.obsPlanningPrep ?? null,
    obsCultureManagement: data.obsCultureManagement ?? null,
    obsInstructionMusicianship: data.obsInstructionMusicianship ?? null,
    obsEngagementEvidence: data.obsEngagementEvidence ?? null,
    obsProfessionalismGrowth: data.obsProfessionalismGrowth ?? null,
    notes: data.obsNotes,
  };
  return observationHasContent(o) ? o : null;
}

/**
 * Whether an entry records anything at all. A ticked class with nothing
 * against it still names whose class it was, which is worth keeping; an entry
 * with no teacher, no programme, no rating and no note is nothing, and storing
 * it would read later as "observed, rated nothing".
 */
function observationHasContent(o: ObservationInput): boolean {
  return (
    !!o.teacherId ||
    !!o.subjectId ||
    RATING_KEYS.some((k) => !!o[k]) ||
    !!o.notes?.trim()
  );
}

/** The columns of a VisitObservation, from what a form sent. */
function observationRow(o: ObservationInput) {
  return {
    teacherId: o.teacherId || null,
    subjectId: o.subjectId || null,
    obsPlanningPrep: o.obsPlanningPrep ?? null,
    obsCultureManagement: o.obsCultureManagement ?? null,
    obsInstructionMusicianship: o.obsInstructionMusicianship ?? null,
    obsEngagementEvidence: o.obsEngagementEvidence ?? null,
    obsProfessionalismGrowth: o.obsProfessionalismGrowth ?? null,
    notes: o.notes?.trim() || null,
  };
}

/**
 * Whether a visit can hold classroom observations at all: in person, the RM
 * met the YMU teacher, and answered "Did you see a class?" with yes. The same
 * three conditions the forms use to show the rubric, held here too so a stale
 * client cannot record a lesson rubric for a phone call or a skipped class.
 */
function canHoldObservations(v: {
  mode: string;
  visitedWith: readonly string[];
  obsSkipReason?: string | null;
}): boolean {
  return v.mode === "IN_PERSON" && v.visitedWith.includes("YMU_TEACHER") && v.obsSkipReason == null;
}

/**
 * Rewrites a visit's observations to `incoming`, keeping the id of every one
 * the client sent back.
 *
 * Not deleteMany + createMany, though that would be shorter. The id is what
 * YMU-A files the teacher's evaluation under, so recreating an observation
 * the RM merely corrected would hand the teacher a "new" evaluation and leave
 * the relay to delete the old one — a notification for nothing, and a broken
 * link from anything that pointed at it. An id that belongs to another visit
 * is treated as absent rather than trusted, so an edit can never reach into
 * somebody else's record.
 */
async function replaceVisitObservations(
  tx: Prisma.TransactionClient,
  visitId: string,
  incoming: ObservationInput[],
) {
  const existing = await tx.visitObservation.findMany({ where: { visitId }, select: { id: true } });
  const existingIds = new Set(existing.map((o) => o.id));
  const kept = new Set<string>();
  const updates: { id: string; o: ObservationInput }[] = [];
  const creates: ObservationInput[] = [];
  for (const o of incoming.filter(observationHasContent)) {
    // The same id twice keeps the first; the second becomes a new row.
    if (o.id && existingIds.has(o.id) && !kept.has(o.id)) {
      kept.add(o.id);
      updates.push({ id: o.id, o });
    } else {
      creates.push(o);
    }
  }
  await tx.visitObservation.deleteMany({ where: { visitId, id: { notIn: [...kept] } } });
  for (const { id, o } of updates) {
    await tx.visitObservation.update({ where: { id }, data: observationRow(o) });
  }
  if (creates.length) {
    await tx.visitObservation.createMany({ data: creates.map((o) => ({ visitId, ...observationRow(o) })) });
  }
}

/** What the visit-reading actions select of each observation. */
const observationInclude = {
  teacher: { select: { name: true } },
  subject: { select: { name: true } },
} satisfies Prisma.VisitObservationInclude;

// createdAt first; the id breaks ties between rows written in one statement.
const observationOrder: Prisma.VisitObservationOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

type ObservationWithNames = Prisma.VisitObservationGetPayload<{ include: typeof observationInclude }>;

/** One observation, shaped for the client: names alongside ids, ratings grouped. */
function serializeObservation(o: ObservationWithNames) {
  return {
    id: o.id,
    teacherId: o.teacherId,
    teacherName: o.teacher?.name ?? null,
    subjectId: o.subjectId,
    subjectName: o.subject?.name ?? null,
    ratings: {
      obsPlanningPrep: o.obsPlanningPrep,
      obsCultureManagement: o.obsCultureManagement,
      obsInstructionMusicianship: o.obsInstructionMusicianship,
      obsEngagementEvidence: o.obsEngagementEvidence,
      obsProfessionalismGrowth: o.obsProfessionalismGrowth,
    },
    notes: o.notes,
  };
}

const confirmVisitSchema = z
  .object({
    // Only used for the first visit of the day (client asks the RM where
    // they're starting from). Every subsequent visit that day is chained
    // server-side from the previous confirmed visit and this is ignored.
    // In person is the default; online and phone visits skip the drive and
    // the classroom observation entirely.
    mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]).default("IN_PERSON"),
    // Van and other-person's-car miles are measured but never reimbursed;
    // see the mileage report.
    vehicle: z.enum(["PERSONAL", "YMU_VAN", "OTHER_PERSON_CAR"]).default("PERSONAL"),
    origin: originCoordsSchema.optional(),
    visitedWith: z.array(z.enum(["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER", "YMU_TEACHER"])).default([]),
    principalNotes: z.string().max(2000).optional(),
    hasInstrumentRequest: z.boolean().default(false),
    instrumentRequestDetails: z.string().max(2000).optional(),
    geofenceDistanceM: z.number().optional(),
    geofenceOverridden: z.boolean().default(false),
    // Teacher observation — shown when visitedWith includes YMU_TEACHER. One
    // entry per class watched; the planner pre-ticks the slot's own class.
    observations: observationsSchema.optional(),
    // What an older bundle sends instead of `observations`.
    ...legacyObservationFields,
    // Set instead of observations when there was no lesson to watch.
    obsSkipReason: observationSkipReasonSchema.optional(),
    obsSkipNotes: z.string().max(2000).optional(),
  })
  .refine((data) => !data.hasInstrumentRequest || !!data.instrumentRequestDetails?.trim(), {
    message: "instrumentRequestDetails is required when hasInstrumentRequest is true",
    path: ["instrumentRequestDetails"],
  });

/**
 * The Miami calendar day containing `date`, as a half-open-ish instant range.
 *
 * Anchored to Miami rather than the host so a visit written on one server and
 * read on another still falls inside its own day — the chaining that prices
 * each leg depends on finding the day's earlier visits.
 */
function dayRangeFor(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayKey = dayKeyInAppZone(date);
  const dayStart = zonedDayStart(dayKey);
  const dayEnd = new Date(zonedDayStart(addDaysToDayKey(dayKey, 1)).getTime() - 1);
  return { dayStart, dayEnd };
}

/**
 * The RM's own most recently confirmed visit earlier the same day (i.e. the
 * previous stop in the route they actually drove). Ordered by createdAt
 * (actual confirmation order), not plannedStartDateTime — every confirmed
 * visit is stamped with the same fixed 09:00-10:00 planned slot, so that
 * field can't be used to find "the previous stop".
 */
async function findPreviousVisitToday(
  visitedById: string,
  dayStart: Date,
  dayEnd: Date
): Promise<{ lat: number; lng: number; label: string } | null> {
  const prevVisit = await prisma.visit.findFirst({
    where: {
      visitedById,
      status: "DONE",
      // In-person only: a call or a video visit is somewhere you were, not
      // somewhere you drove. Chaining through one billed the leg from wherever
      // that school happens to be — a phone call to Air Base, thirty miles
      // south, made the next stop look like a thirty-mile drive. The route
      // editor already skipped them; this is the live path catching up.
      mode: "IN_PERSON",
      plannedStartDateTime: { gte: dayStart, lt: dayEnd },
    },
    // By the stop's own slot, not by when it was typed in. Ordering on createdAt
    // meant the route was whatever order someone happened to enter it in, and a
    // stop remembered late landed at the end of the day no matter when it
    // actually happened. createdAt only breaks ties among older rows that all
    // share a slot.
    orderBy: [{ plannedStartDateTime: "desc" }, { createdAt: "desc" }],
    select: { school: { select: { name: true, lat: true, lng: true } } },
  });
  if (prevVisit?.school.lat != null && prevVisit.school.lng != null) {
    return { lat: prevVisit.school.lat, lng: prevVisit.school.lng, label: prevVisit.school.name };
  }
  return null;
}

/**
 * Whether confirming a visit on `dateIso` would be the RM's first *drive* of
 * the day — in which case the UI asks where they're starting from — or a later
 * one, where mileage chains from the previous stop and no question is needed.
 *
 * A day of nothing but calls has no previous stop, so the next in-person visit
 * is still asked for its origin.
 */
export async function getPreviousVisitToday(dateIso: string): Promise<{ label: string } | null> {
  const session = await auth();
  const user = requireUser(session);
  const { dayStart, dayEnd } = dayRangeFor(new Date(dateIso));
  const prev = await findPreviousVisitToday(user.id, dayStart, dayEnd);
  return prev ? { label: prev.label } : null;
}

/**
 * Resolves the origin for a visit's mileage calculation: the chained
 * previous visit if one exists (always wins — the client can't override an
 * in-progress route), otherwise the origin the client supplied for the
 * first visit of the day, otherwise the RM's saved home as a last resort.
 */
async function resolveVisitOrigin(
  visitedById: string,
  dayStart: Date,
  dayEnd: Date,
  clientOrigin?: { lat: number; lng: number; label?: string; isHome?: boolean }
): Promise<{ lat: number; lng: number; label: string; isCommute: boolean } | null> {
  // Chained from the previous stop: work location to work location, which is
  // business mileage however the day began.
  const chained = await findPreviousVisitToday(visitedById, dayStart, dayEnd);
  if (chained) return { ...chained, isCommute: false };

  const homeUser = await prisma.user.findUnique({
    where: { id: visitedById },
    select: { homeLat: true, homeLng: true },
  });
  const home =
    homeUser?.homeLat != null && homeUser?.homeLng != null
      ? { lat: homeUser.homeLat, lng: homeUser.homeLng }
      : null;

  if (clientOrigin) {
    // Trusting the picker alone would miss someone typing their own address into
    // "Other address", so the coordinates are checked against the saved home too.
    // Judged on where it is, not on which button was pressed.
    const startedAtHome =
      clientOrigin.isHome === true ||
      (home != null &&
        haversineMeters(clientOrigin.lat, clientOrigin.lng, home.lat, home.lng) <= HOME_MATCH_RADIUS_M);

    return {
      lat: clientOrigin.lat,
      lng: clientOrigin.lng,
      label: clientOrigin.label ?? "Custom address",
      isCommute: startedAtHome,
    };
  }

  if (home) return { ...home, label: "Home", isCommute: true };

  return null;
}

const METERS_PER_MILE = 1609.344;

/** The day's stops sit on hourly slots from 9am Miami, which is what orders them. */
const DAY_FIRST_SLOT_HOUR = 9;
const SLOT_MS = 3600_000;

async function nextSlotForDay(visitedById: string, dayKey: string): Promise<Date> {
  const dayStart = zonedDayStart(dayKey);
  const dayEnd = new Date(zonedDayStart(addDaysToDayKey(dayKey, 1)).getTime() - 1);
  const count = await prisma.visit.count({
    where: {
      visitedById,
      status: "DONE",
      plannedStartDateTime: { gte: dayStart, lt: dayEnd },
    },
  });
  return new Date(dayStart.getTime() + (DAY_FIRST_SLOT_HOUR + count) * SLOT_MS);
}

/**
 * How close an origin has to be to the RM's saved home to count as starting from
 * home. Generous enough to absorb geocoder disagreement between two spellings of
 * the same address — the two providers here can differ by ~113m on one building.
 */
const HOME_MATCH_RADIUS_M = 250;

/**
 * Road miles between two points, or null if the routing service can't say.
 *
 * Mileage is never worth failing a visit over — an RM standing in a parking lot
 * should not lose their record because a distance API timed out. Every caller
 * treats null as "unknown" and saves the visit regardless.
 */
async function computeLegMiles(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<number | null> {
  try {
    const matrix = await getCachedTravelMatrix(
      [{ lat: origin.lat, lng: origin.lng }, { lat: destination.lat, lng: destination.lng }],
      prisma,
      new OpenRouteDistanceService()
    );
    const distanceM = matrix.distances[0]?.[1];
    if (distanceM != null && Number.isFinite(distanceM)) return distanceM / METERS_PER_MILE;
  } catch (err) {
    console.error("mileage calc failed:", err);
  }
  return null;
}

/**
 * Which programme a visit watched, when the client did not name one.
 *
 * The planner names it outright: it booked the visit against a class slot and
 * knows which. Two paths cannot — a client from before the field existed, and
 * the Log Visit form, which asks for a day and never for a period. Left alone
 * those write the blank this column was added to stop.
 *
 * Given the class time, the slot running at that moment is the answer and
 * there is nothing to infer. Falling back to the day only counts when the day
 * is unambiguous: one programme taught there that day leaves no choice to
 * make, two would have this function making it, and a programme guessed onto a
 * rating reads afterwards as something the RM recorded. That is the same line
 * observedTeacherId draws — better blank than a plausible name.
 */
async function observedSubjectFor(schoolId: string, when: Date): Promise<string | undefined> {
  const running = await prisma.classSession.findFirst({
    where: { schoolId, startDateTime: { lte: when }, endDateTime: { gt: when } },
    select: { subjectId: true },
    orderBy: { startDateTime: "asc" },
  });
  if (running) return running.subjectId;

  const { dayStart, dayEnd } = dayRangeFor(when);
  const sameDay = await prisma.classSession.findMany({
    where: { schoolId, startDateTime: { gte: dayStart, lt: dayEnd } },
    select: { subjectId: true },
    distinct: ["subjectId"],
    take: 2,
  });
  return sameDay.length === 1 ? sameDay[0].subjectId : undefined;
}

/**
 * The observations a newly confirmed or logged visit stores.
 *
 * None unless the visit can hold them (canHoldObservations): a phone call, a
 * skip reason or a visit that never met the YMU teacher records no lesson, and
 * that is enforced here rather than trusted to the form.
 *
 * A current client sends `observations`, one per class ticked, and its word is
 * final — a class the RM left as "Not recorded" stays unrecorded. An older
 * bundle sends the single-observation fields instead; those become one entry,
 * and when they carry no programme the server works it out the way it always
 * did for them (inferSubject), so a cached phone loses nothing it had.
 */
async function observationsForNewVisit(
  data: LegacyObservationFields & {
    mode: string;
    visitedWith: string[];
    obsSkipReason?: string | null;
    observations?: ObservationInput[];
  },
  inferSubject: () => Promise<string | undefined>,
): Promise<ObservationInput[]> {
  if (!canHoldObservations(data)) return [];
  if (data.observations) return data.observations.filter(observationHasContent);
  const legacy = legacyObservation(data) ?? {};
  if (!legacy.subjectId) legacy.subjectId = (await inferSubject()) ?? null;
  return observationHasContent(legacy) ? [legacy] : [];
}

export async function confirmVisit(schoolId: string, dateIso: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);
  // Oversight roles read every region and change nobody's week: a CPO
  // confirming or skipping a visit they did not make would land on somebody
  // else's record and somebody else's mileage. Checked on the server, not just
  // hidden in the nav — a hidden button is not a permission.
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role cannot change visits");

  const parsed = confirmVisitSchema.safeParse(formData);
  if (!parsed.success) throw new Error(parsed.error.message);
  const data = parsed.data;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { lat: true, lng: true },
  });
  if (!school) throw new Error("School not found");

  // Anchored to 9am Miami, not the host's 9am. setHours() here meant that a
  // date landing after 8pm Miami — already tomorrow in UTC — was filed under
  // the wrong day on a UTC server.
  const date = new Date(dateIso);
  const dayKey = dayKeyInAppZone(date);
  // Each stop gets the next slot of the day, which is what puts the route in
  // order and lets it be reordered later.
  const plannedStart = await nextSlotForDay(user.id, dayKey);
  const plannedEnd = new Date(plannedStart.getTime() + SLOT_MS);
  const { dayStart, dayEnd } = dayRangeFor(date);

  // Mileage is auto-derived from the RM's own route order that day (previous
  // confirmed visit → this school). For the first visit of the day, the
  // client already asked where they're starting from (data.origin); that's
  // only used when there's no previous visit to chain from. Best-effort: if
  // no origin is available at all, the visit still confirms with
  // milesDriven unset.
  let milesDriven: number | null = null;
  let originLabel: string | null = null;
  let originLat: number | null = null;
  let originLng: number | null = null;
  let commuteMiles: number | null = null;

  // A remote visit has no leg to measure. Leaving milesDriven null (rather than
  // zero) is what keeps it out of the mileage report entirely.
  const isRemote = data.mode !== "IN_PERSON";

  if (!isRemote && school.lat != null && school.lng != null) {
    try {
      const origin = await resolveVisitOrigin(user.id, dayStart, dayEnd, data.origin);
      if (origin) {
        originLabel = origin.label;
        originLat = origin.lat;
        originLng = origin.lng;
        milesDriven = await computeLegMiles(origin, { lat: school.lat, lng: school.lng });
        // Home to the first school is the morning commute, not business mileage.
        if (origin.isCommute && milesDriven != null) commuteMiles = milesDriven;
      }
    } catch (err) {
      console.error("confirmVisit mileage calc failed:", err);
    }
  }

  // dateIso is the class slot's start, not plannedStart — plannedStart is the
  // route position this stop takes in the RM's day and has nothing to do with
  // when the class runs.
  const observations = await observationsForNewVisit(data, () => observedSubjectFor(schoolId, date));

  const visit = await prisma.$transaction(async (tx) => {
    // Cancel any PLANNED visit for this school+day before writing DONE
    await tx.visit.updateMany({
      where: {
        schoolId,
        status: "PLANNED",
        plannedStartDateTime: { gte: plannedStart, lte: plannedEnd },
      },
      data: { status: "CANCELLED" },
    });
    return tx.visit.create({
      data: {
        schoolId,
        plannedStartDateTime: plannedStart,
        plannedEndDateTime: plannedEnd,
        status: "DONE",
        reason: "Confirmed via Weekly Planner",
        visitedById: user.id,
        mode: data.mode,
        vehicle: data.vehicle,
        milesDriven: milesDriven ?? undefined,
        commuteMiles: commuteMiles ?? undefined,
        originLabel: originLabel ?? undefined,
        originLat: originLat ?? undefined,
        originLng: originLng ?? undefined,
        visitedWith: data.visitedWith,
        principalNotes: data.principalNotes ?? undefined,
        hasInstrumentRequest: data.hasInstrumentRequest,
        instrumentRequestDetails: data.instrumentRequestDetails ?? undefined,
        // Location and classroom observation only mean something in person.
        // Dropped server-side too, so a stale client cannot record a geofence
        // check or a lesson rubric for a phone call.
        geofenceDistanceM: isRemote ? undefined : data.geofenceDistanceM ?? undefined,
        geofenceOverridden: isRemote ? false : data.geofenceOverridden,
        obsSkipReason: isRemote ? undefined : data.obsSkipReason,
        obsSkipNotes: isRemote ? undefined : data.obsSkipNotes ?? undefined,
        // Empty on a remote or skipped visit — observationsForNewVisit decides.
        observations: { create: observations.map(observationRow) },
      },
    });
  });

  // Server actions can only return plain-serializable values to Client
  // Components — Prisma's Decimal type isn't, so convert it here.
  // #56: share the observation with the teacher in YMU-A, after the
  // response so the RM's save never waits on it.
  after(() => syncEvaluationToYmua(prisma, visit.id).then(() => undefined));
  return { id: visit.id, milesDriven: decimalToNumber(visit.milesDriven) };
}

export async function skipVisit(schoolId: string, dateIso: string) {
  const session = await auth();
  const user = requireUser(session);
  // Oversight roles read every region and change nobody's week: a CPO
  // confirming or skipping a visit they did not make would land on somebody
  // else's record and somebody else's mileage. Checked on the server, not just
  // hidden in the nav — a hidden button is not a permission.
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role cannot change visits");

  const date = new Date(dateIso);
  const plannedStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0)
  );
  const plannedEnd = new Date(plannedStart.getTime() + 60 * 60 * 1000);
  const visit = await prisma.visit.create({
    data: {
      schoolId,
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      status: "SKIPPED",
      reason: "Skipped by user",
    },
  });
  return serializeVisit(visit);
}

export async function getVisitHistory(regionFilter?: string | null) {
  const session = await auth();
  const user = requireUser(session);
  const baseWhere = schoolRegionWhere(user);

  // An ADMIN passing a regionFilter is inspecting that region, not reviewing their
  // own work, so the "my own visits" escape hatch below must not widen their filter.
  const isAdminFilter = canFilterByRegion(user.role) && !!regionFilter;
  const effectiveRegionId = isAdminFilter
    ? regionFilter
    : baseWhere.regionId !== undefined
    ? baseWhere.regionId
    : undefined;

  const visits = await prisma.visit.findMany({
    where: {
      status: "DONE",
      ...(effectiveRegionId !== undefined
        ? {
            OR: [
              { school: { regionId: effectiveRegionId } },
              // A visit this user logged against another region's school is still
              // theirs; without this it would vanish from the list on save.
              ...(isAdminFilter ? [] : [{ visitedById: user.id }]),
            ],
          }
        : {}),
    },
    include: {
      school: { include: { region: { select: { name: true } } } },
      visitedBy: { select: { name: true, email: true } },
      observations: { include: observationInclude, orderBy: observationOrder },
    },
    orderBy: [{ plannedStartDateTime: "asc" }, { createdAt: "asc" }],
  });

  // Newest day first, but each day read in the order it was driven: the first
  // stop at the top, the way the route actually went. Sorting the whole list
  // descending put every day backwards.
  const byDay = new Map<string, typeof visits>();
  for (const v of visits) {
    const k = dayKeyInAppZone(v.plannedStartDateTime);
    byDay.set(k, [...(byDay.get(k) ?? []), v]);
  }
  const ordered = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .flatMap(([, dayVisits]) => dayVisits.map((v, i) => ({ visit: v, stopNumber: i + 1 })));

  // Normalize to the shape VisitHistory.tsx expects
  return ordered.map(({ visit: v, stopNumber }) => ({
    stopNumber,
    id: v.id,
    schoolId: v.schoolId,
    date: v.plannedStartDateTime,
    notes: v.reason,
    school: v.school,
    mode: v.mode,
    vehicle: v.vehicle,
    // The visit form's own record: who was seen, what was discussed, how the
    // teacher was rated. Written since the form existed but never read back, so
    // none of it was visible anywhere.
    visitedWith: v.visitedWith,
    principalNotes: v.principalNotes,
    // One per class watched, each with its own ratings and notes.
    observations: v.observations.map(serializeObservation),
    obsSkipReason: v.obsSkipReason,
    obsSkipNotes: v.obsSkipNotes,
    hasInstrumentRequest: v.hasInstrumentRequest,
    instrumentRequestDetails: v.instrumentRequestDetails,
    geofenceOverridden: v.geofenceOverridden,
    visitedByName: v.visitedBy?.name ?? v.visitedBy?.email ?? null,
    // Decimal doesn't survive the server/client boundary.
    milesDriven: decimalToNumber(v.milesDriven),
    returnMilesDriven: decimalToNumber(v.returnMilesDriven),
    commuteMiles: decimalToNumber(v.commuteMiles),
    returnCommuteMiles: decimalToNumber(v.returnCommuteMiles),
    originLabel: v.originLabel,
    // Non-null only for rows outside the region being viewed, so the table can flag them.
    otherRegionName:
      effectiveRegionId !== undefined && v.school.regionId !== effectiveRegionId
        ? v.school.region?.name ?? "Unassigned"
        : null,
  }));
}

/**
 * Everything the Log Visit form can record. Same shape the Confirm Visit modal
 * sends. The geofence fields used to be left out on the theory that a manual
 * log is typed in after the fact — but a same-day in-person log is usually
 * typed at the school, and once the Dashboard's quick button made this the
 * main path, visits stopped carrying any location (YMU 2026-10-12). The form
 * now runs the check for a visit logged today; an earlier day arrives as
 * unverified, exactly as it does through the confirm modal.
 */
const manualVisitSchema = z.object({
  mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]).default("IN_PERSON"),
  vehicle: z.enum(["PERSONAL", "YMU_VAN", "OTHER_PERSON_CAR"]).default("PERSONAL"),
  origin: originCoordsSchema.optional(),
  notes: z.string().max(2000).optional(),
  visitedWith: z.array(z.enum(["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER", "YMU_TEACHER"])).default([]),
  principalNotes: z.string().max(2000).optional(),
  hasInstrumentRequest: z.boolean().default(false),
  instrumentRequestDetails: z.string().max(2000).optional(),
  // One entry per class watched — see observationInputSchema.
  observations: observationsSchema.optional(),
  // What an older bundle sends instead of `observations`.
  ...legacyObservationFields,
  obsSkipReason: observationSkipReasonSchema.optional(),
  obsSkipNotes: z.string().max(2000).optional(),
  geofenceDistanceM: z.number().optional(),
  geofenceOverridden: z.boolean().default(false),
});

export async function addManualVisit(schoolId: string, dateIso: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);
  // Oversight roles read every region and change nobody's week: a CPO
  // confirming or skipping a visit they did not make would land on somebody
  // else's record and somebody else's mileage. Checked on the server, not just
  // hidden in the nav — a hidden button is not a permission.
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role cannot change visits");

  const parsed = manualVisitSchema.safeParse(formData ?? {});
  if (!parsed.success) throw new Error(parsed.error.message);
  const data = parsed.data;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { lat: true, lng: true },
  });
  if (!school) throw new Error("School not found");

  const dayKey = toAppZoneDayKey(dateIso);
  const plannedStart = await nextSlotForDay(user.id, dayKey);
  const plannedEnd = new Date(plannedStart.getTime() + SLOT_MS);
  const { dayStart, dayEnd } = dayRangeFor(plannedStart);

  // Same rules as a planner-confirmed visit: chain from the previous stop that
  // day, else the origin the form asked for, else the RM's saved home. Without
  // this a manually-logged visit contributed nothing to the mileage report.
  const isRemote = data.mode !== "IN_PERSON";
  let milesDriven: number | null = null;
  let originLabel: string | null = null;
  let originLat: number | null = null;
  let originLng: number | null = null;
  let commuteMiles: number | null = null;

  if (!isRemote && school.lat != null && school.lng != null) {
    const origin = await resolveVisitOrigin(user.id, dayStart, dayEnd, data.origin);
    if (origin) {
      originLabel = origin.label;
      originLat = origin.lat;
      originLng = origin.lng;
      milesDriven = await computeLegMiles(origin, { lat: school.lat, lng: school.lng });
      if (origin.isCommute && milesDriven != null) commuteMiles = milesDriven;
    }
  }

  // plannedStart is the route slot, but it does land on the day the RM picked,
  // which is all the day-level fallback an older client needs.
  const observations = await observationsForNewVisit(data, () => observedSubjectFor(schoolId, plannedStart));

  const visit = await prisma.visit.create({
    data: {
      schoolId,
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      status: "DONE",
      reason: data.notes?.trim() || "Manual logging",
      // Deliberately not region-checked: logging a visit to another region's school
      // is supported. Stamping the author is what keeps it in their own history.
      visitedById: user.id,
      mode: data.mode,
      vehicle: data.vehicle,
      milesDriven: milesDriven ?? undefined,
      commuteMiles: commuteMiles ?? undefined,
      originLabel: originLabel ?? undefined,
      originLat: originLat ?? undefined,
      originLng: originLng ?? undefined,
      visitedWith: data.visitedWith,
      principalNotes: data.principalNotes ?? undefined,
      hasInstrumentRequest: data.hasInstrumentRequest,
      instrumentRequestDetails: data.instrumentRequestDetails ?? undefined,
      geofenceDistanceM: isRemote ? undefined : data.geofenceDistanceM ?? undefined,
      geofenceOverridden: isRemote ? false : data.geofenceOverridden,
      // A remote visit has no classroom, and a skipped observation carries a
      // reason instead of ratings — never both. observationsForNewVisit
      // returns none for either.
      observations: { create: observations.map(observationRow) },
      obsSkipReason: isRemote ? undefined : data.obsSkipReason,
      obsSkipNotes: isRemote ? undefined : data.obsSkipNotes ?? undefined,
    },
  });
  // #56: keep the teacher's Evaluations in YMU-A in step with this visit.
  after(() => syncEvaluationToYmua(prisma, visit.id).then(() => undefined));
  return serializeVisit(visit);
}

/**
 * Books the drive home at the end of a day's visits.
 *
 * The per-visit legs only ever measured the trip *toward* a school, so the
 * final drive back — routinely the longest single leg of the day — went
 * unbilled. It is stored on the day's last visit rather than as a row of its
 * own, which keeps the mileage report a single query and makes a second call
 * for the same day an update instead of a duplicate.
 *
 * Returns null when the day has no in-person visit to close, or when the RM
 * has no saved home and supplied no destination.
 */
/** Today's driving at a glance, for the banner above the history table. */
export async function getMyDayStatus(dateIso: string) {
  const session = await auth();
  const user = requireUser(session);
  const { dayStart, dayEnd } = dayRangeFor(new Date(dateIso));

  const visits = await prisma.visit.findMany({
    where: {
      visitedById: user.id,
      status: "DONE",
      plannedStartDateTime: { gte: dayStart, lte: dayEnd },
    },
    select: {
      milesDriven: true,
      returnMilesDriven: true,
      commuteMiles: true,
      returnCommuteMiles: true,
      mode: true,
      vehicle: true,
    },
  });

  const drivenOf = (v: (typeof visits)[number]) =>
    (decimalToNumber(v.milesDriven) ?? 0) + (decimalToNumber(v.returnMilesDriven) ?? 0);
  const commuteOf = (v: (typeof visits)[number]) =>
    (decimalToNumber(v.commuteMiles) ?? 0) + (decimalToNumber(v.returnCommuteMiles) ?? 0);

  const personal = visits.filter((v) => v.vehicle === "PERSONAL");
  const van = visits.filter((v) => v.vehicle === "YMU_VAN");
  const otherCar = visits.filter((v) => v.vehicle === "OTHER_PERSON_CAR");

  const drivenMiles = personal.reduce((sum, v) => sum + drivenOf(v), 0);
  const commuteMiles = personal.reduce((sum, v) => sum + commuteOf(v), 0);

  return {
    visitCount: visits.length,
    inPersonCount: visits.filter((v) => v.mode === "IN_PERSON").length,
    // Everything actually driven in the RM's own car today.
    drivenMiles,
    // The first and last legs of the day, which the IRS rule leaves unpaid.
    commuteMiles,
    // What that comes to as a reimbursement.
    totalMiles: drivenMiles - commuteMiles,
    vanMiles: van.reduce((sum, v) => sum + drivenOf(v), 0),
    // Rode along with someone else — recorded, owed to nobody, tracked apart
    // from the van because it isn't YMU's fuel either.
    otherCarMiles: otherCar.reduce((sum, v) => sum + drivenOf(v), 0),
  };
}

/**
 * In-person visits of this RM's that were never given a mileage figure.
 *
 * Mileage is best-effort by design: computeLegMiles swallows a routing-service
 * failure and returns null so that a visit still confirms rather than being
 * lost with its notes. The cost of that choice was silence — the mileage report
 * only counts visits with a measured leg, so a failed calculation did not show
 * up as a zero or a gap, it showed up as nothing at all, and the miles were
 * gone without anyone knowing they had been driven.
 *
 * No new column records this. A visit that should have miles and does not is
 * already identifiable: it is IN_PERSON, DONE, and has no milesDriven. And
 * whether it can be recalculated unattended is written in originLat/originLng,
 * because the origin is resolved and stored BEFORE the distance is fetched —
 * so a row with an origin and no miles is precisely one where the routing call
 * is what failed.
 */
export type MileageGap = {
  id: string;
  date: Date;
  schoolName: string;
  originLabel: string | null;
  /** The origin is on file, so this only needs the routing service to answer. */
  retryable: boolean;
};

export async function getMileageGaps(): Promise<MileageGap[]> {
  const session = await auth();
  const user = requireUser(session);

  // The RM's own driving. Mileage is owed to the person who drove it, so a gap
  // is theirs to see and theirs to fix.
  const gaps = await prisma.visit.findMany({
    where: {
      visitedById: user.id,
      status: "DONE",
      mode: "IN_PERSON",
      milesDriven: null,
    },
    select: {
      id: true,
      plannedStartDateTime: true,
      originLabel: true,
      originLat: true,
      originLng: true,
      school: { select: { name: true } },
    },
    orderBy: { plannedStartDateTime: "desc" },
  });

  return gaps.map((v) => ({
    id: v.id,
    date: v.plannedStartDateTime,
    schoolName: v.school.name,
    originLabel: v.originLabel,
    retryable: v.originLat != null && v.originLng != null,
  }));
}

/**
 * Recalculate the mileage for every gap that has an origin on file.
 *
 * Deliberately does NOT invent a starting point for the ones that have none.
 * A guessed origin produces a number that looks measured, goes onto a
 * reimbursement, and cannot be told apart from a real one afterwards; an
 * obvious gap can at least be corrected by the person who drove it.
 */
export async function retryMileageGaps(): Promise<{ fixed: number; remaining: number }> {
  const session = await auth();
  const user = requireUser(session);
  // Oversight roles read every region and change nobody's week: a CPO
  // confirming or skipping a visit they did not make would land on somebody
  // else's record and somebody else's mileage. Checked on the server, not just
  // hidden in the nav — a hidden button is not a permission.
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role cannot change visits");

  const gaps = await prisma.visit.findMany({
    where: {
      visitedById: user.id,
      status: "DONE",
      mode: "IN_PERSON",
      milesDriven: null,
      originLat: { not: null },
      originLng: { not: null },
    },
    select: {
      id: true,
      plannedStartDateTime: true,
      originLat: true,
      originLng: true,
      school: { select: { lat: true, lng: true } },
    },
  });

  const home = await prisma.user.findUnique({
    where: { id: user.id },
    select: { homeLat: true, homeLng: true },
  });

  let fixed = 0;

  for (const gap of gaps) {
    if (gap.school.lat == null || gap.school.lng == null) continue;

    const miles = await computeLegMiles(
      { lat: gap.originLat!, lng: gap.originLng! },
      { lat: gap.school.lat, lng: gap.school.lng }
    );
    if (miles == null) continue; // still down — the banner stays up

    // Same commute rule the original calculation used: the leg counts as
    // commute when it started at home AND nothing was driven earlier that day.
    // Both halves matter — a school within a few streets of the RM's house
    // would otherwise turn a mid-route leg into an unpaid one.
    const startedAtHome =
      home?.homeLat != null &&
      home.homeLng != null &&
      haversineMeters(gap.originLat!, gap.originLng!, home.homeLat, home.homeLng) <= HOME_MATCH_RADIUS_M;

    const { dayStart } = dayRangeFor(gap.plannedStartDateTime);
    const earlierThatDay = startedAtHome
      ? await prisma.visit.count({
          where: {
            visitedById: user.id,
            status: "DONE",
            mode: "IN_PERSON",
            plannedStartDateTime: { gte: dayStart, lt: gap.plannedStartDateTime },
          },
        })
      : 0;

    await prisma.visit.update({
      where: { id: gap.id },
      data: {
        milesDriven: miles,
        commuteMiles: startedAtHome && earlierThatDay === 0 ? miles : null,
      },
    });
    fixed += 1;
  }

  const remaining = await prisma.visit.count({
    where: {
      visitedById: user.id,
      status: "DONE",
      mode: "IN_PERSON",
      milesDriven: null,
    },
  });

  return { fixed, remaining };
}

/**
 * The RM's stops for one day, in route order, for reviewing or reordering.
 */
export async function getDayRoute(dateIso: string) {
  const session = await auth();
  const user = requireUser(session);
  const { dayStart, dayEnd } = dayRangeFor(new Date(dateIso));

  const visits = await prisma.visit.findMany({
    where: {
      visitedById: user.id,
      status: "DONE",
      plannedStartDateTime: { gte: dayStart, lt: dayEnd },
    },
    orderBy: [{ plannedStartDateTime: "asc" }, { createdAt: "asc" }],
    include: { school: { select: { name: true, lat: true, lng: true } } },
  });

  return visits.map((v, i) => ({
    id: v.id,
    position: i + 1,
    schoolName: v.school.name,
    mode: v.mode,
    milesDriven: decimalToNumber(v.milesDriven),
    commuteMiles: decimalToNumber(v.commuteMiles),
    originLabel: v.originLabel,
  }));
}

/**
 * Reorders a day's stops and reprices the whole day from its original starting
 * point.
 *
 * Remembering a stop late, or in the wrong order, used to leave every following
 * leg measured from the wrong school with no way to correct it — the only remedy
 * was deleting the day and retyping every note. Each leg is recomputed from the
 * stop now in front of it; the day's first leg keeps the origin the day actually
 * started from, which reordering does not change.
 *
 * `orderedIds` must name exactly the day's stops. Anything else is rejected
 * rather than partly applied.
 */
export async function reorderDayVisits(dateIso: string, orderedIds: string[]) {
  const session = await auth();
  const user = requireUser(session);
  // Oversight roles read every region and change nobody's week: a CPO
  // confirming or skipping a visit they did not make would land on somebody
  // else's record and somebody else's mileage. Checked on the server, not just
  // hidden in the nav — a hidden button is not a permission.
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role cannot change visits");
  const { dayStart, dayEnd } = dayRangeFor(new Date(dateIso));
  const dayKey = dayKeyInAppZone(new Date(dateIso));

  const existing = await prisma.visit.findMany({
    where: {
      visitedById: user.id,
      status: "DONE",
      plannedStartDateTime: { gte: dayStart, lt: dayEnd },
    },
    orderBy: [{ plannedStartDateTime: "asc" }, { createdAt: "asc" }],
    include: { school: { select: { name: true, lat: true, lng: true } } },
  });

  const existingIds = new Set(existing.map((v) => v.id));
  if (orderedIds.length !== existing.length || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("The new order must list exactly this day's visits.");
  }

  const byId = new Map(existing.map((v) => [v.id, v]));
  const ordered = orderedIds.map((id) => byId.get(id)!);

  // The day began where it began; putting a different stop first doesn't change
  // where the RM set out from, so that origin carries over to whoever is first.
  //
  // It has to be the *current* first stop's origin, not the first row that
  // happens to have coordinates. After one reorder every row carries an origin —
  // its predecessor — so searching for the first non-null one picked a school
  // mid-route and left the day starting from a stop later in its own sequence.
  const firstStop = existing[0];
  let startPoint =
    firstStop?.originLat != null && firstStop.originLng != null
      ? { lat: firstStop.originLat, lng: firstStop.originLng, label: firstStop.originLabel ?? "Start" }
      : null;
  let startIsCommute = (firstStop?.commuteMiles ?? null) != null;

  // Nothing recorded for a day logged before origins were kept as coordinates.
  // Home is the honest default: it is where a day starts unless told otherwise,
  // and it is the case the IRS rule turns on.
  if (!startPoint) {
    const home = await prisma.user.findUnique({
      where: { id: user.id },
      select: { homeLat: true, homeLng: true },
    });
    if (home?.homeLat != null && home.homeLng != null) {
      startPoint = { lat: home.homeLat, lng: home.homeLng, label: "Home" };
      startIsCommute = true;
    }
  }

  // A stop cannot be its own day's starting point.
  const firstSchool = ordered.find((v) => v.school.lat != null && v.school.lng != null);
  if (
    startPoint &&
    firstSchool?.school.lat != null &&
    Math.abs(startPoint.lat - firstSchool.school.lat) < 1e-6 &&
    Math.abs(startPoint.lng - firstSchool.school.lng!) < 1e-6
  ) {
    startPoint = null;
  }

  const updates: {
    id: string;
    plannedStartDateTime: Date;
    plannedEndDateTime: Date;
    milesDriven: number | null;
    commuteMiles: number | null;
    originLabel: string | null;
    originLat: number | null;
    originLng: number | null;
  }[] = [];

  let prev: { lat: number; lng: number; label: string } | null = startPoint;
  let isFirstDriven = true;

  for (let i = 0; i < ordered.length; i++) {
    const v = ordered[i];
    const slotStart = new Date(zonedDayStart(dayKey).getTime() + (DAY_FIRST_SLOT_HOUR + i) * SLOT_MS);

    // A remote stop is part of the day's order but breaks no chain: it neither
    // consumes the origin nor becomes the next stop's starting point.
    if (v.mode !== "IN_PERSON" || v.school.lat == null || v.school.lng == null) {
      updates.push({
        id: v.id,
        plannedStartDateTime: slotStart,
        plannedEndDateTime: new Date(slotStart.getTime() + SLOT_MS),
        milesDriven: null,
        commuteMiles: null,
        originLabel: null,
        originLat: null,
        originLng: null,
      });
      continue;
    }

    const miles = prev ? await computeLegMiles(prev, { lat: v.school.lat, lng: v.school.lng }) : null;
    updates.push({
      id: v.id,
      plannedStartDateTime: slotStart,
      plannedEndDateTime: new Date(slotStart.getTime() + SLOT_MS),
      milesDriven: miles,
      // Only the day's opening leg can be the commute.
      commuteMiles: isFirstDriven && startIsCommute ? miles : null,
      originLabel: prev?.label ?? null,
      originLat: prev?.lat ?? null,
      originLng: prev?.lng ?? null,
    });

    prev = { lat: v.school.lat, lng: v.school.lng, label: v.school.name };
    isFirstDriven = false;
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.visit.update({
        where: { id: u.id },
        data: {
          plannedStartDateTime: u.plannedStartDateTime,
          plannedEndDateTime: u.plannedEndDateTime,
          milesDriven: u.milesDriven ?? null,
          commuteMiles: u.commuteMiles ?? null,
          originLabel: u.originLabel,
          originLat: u.originLat,
          originLng: u.originLng,
        },
      })
    )
  );

  return getDayRoute(dateIso);
}

export async function deleteVisitLog(id: string) {
  // Same rule as editVisitLog: signed in, and your own visit unless your role
  // may edit others'. It used to delete any id it was handed.
  const session = await auth();
  const user = requireUser(session);
  const existing = await prisma.visit.findUnique({ where: { id }, select: { visitedById: true } });
  if (!existing) throw new Error("Visit not found");
  if (existing.visitedById && existing.visitedById !== user.id && !canEditOthersVisits(user)) {
    throw new Error("That visit belongs to someone else");
  }
  const visit = await prisma.visit.delete({ where: { id } });
  // #56: removes the evaluation from the teacher's view in YMU-A.
  after(() => syncEvaluationToYmua(prisma, visit.id).then(() => undefined));
  return serializeVisit(visit);
}

/**
 * What can be corrected on a visit already logged.
 *
 * Deliberately not the mileage inputs — mode and origin decide how the day's
 * legs are priced, and changing one here would leave the rest of the day
 * measured against something that no longer holds. Route order and repricing
 * belong to reorderDayVisits. Vehicle is safe: it reclassifies miles already
 * measured rather than changing the distance.
 */
const editVisitSchema = z.object({
  notes: z.string().max(2000).optional(),
  vehicle: z.enum(["PERSONAL", "YMU_VAN", "OTHER_PERSON_CAR"]).optional(),
  visitedWith: z.array(z.enum(["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER", "YMU_TEACHER"])).optional(),
  principalNotes: z.string().max(2000).optional(),
  hasInstrumentRequest: z.boolean().optional(),
  instrumentRequestDetails: z.string().max(2000).optional(),
  // The visit's full list of observations after the edit, saved ones carrying
  // their id. Omitted means "leave them as they are".
  observations: observationsSchema.optional(),
  // What an older bundle sends instead; see editVisitLog for how it lands.
  ...legacyObservationFields,
  obsSkipReason: observationSkipReasonSchema.nullable().optional(),
  obsSkipNotes: z.string().max(2000).optional(),
});

/**
 * The fields an older bundle's edit actually sent, as VisitObservation
 * columns. Undefined stays undefined — "not sent", so not changed — which is
 * how that form always behaved. Null if it sent none of them.
 */
function legacyEditPatch(data: LegacyObservationFields) {
  const patch: {
    teacherId?: string | null;
    subjectId?: string | null;
    notes?: string | null;
  } & { [K in (typeof RATING_KEYS)[number]]?: ObservationInput[K] } = {};
  if (data.observedTeacherId !== undefined) patch.teacherId = data.observedTeacherId || null;
  if (data.observedSubjectId !== undefined) patch.subjectId = data.observedSubjectId || null;
  for (const k of RATING_KEYS) if (data[k] !== undefined) patch[k] = data[k];
  if (data.obsNotes !== undefined) patch.notes = data.obsNotes.trim() || null;
  return Object.keys(patch).length ? patch : null;
}

export async function editVisitLog(id: string, newDateIso: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);

  // A string is what the old two-field form sent; treat it as the note so an
  // older client still works.
  const parsed = editVisitSchema.safeParse(
    typeof formData === "string" ? { notes: formData } : formData ?? {}
  );
  if (!parsed.success) throw new Error(parsed.error.message);
  const data = parsed.data;

  const existing = await prisma.visit.findUnique({
    where: { id },
    select: {
      visitedById: true,
      plannedStartDateTime: true,
      mode: true,
      visitedWith: true,
      obsSkipReason: true,
      observations: { select: { id: true }, orderBy: observationOrder, take: 1 },
    },
  });
  if (!existing) throw new Error("Visit not found");
  if (existing.visitedById && existing.visitedById !== user.id && !canEditOthersVisits(user)) {
    throw new Error("That visit belongs to someone else");
  }

  // Moving a visit to another day would drop it out of the route it was priced
  // against, so the day is only changed when it actually differs — and the
  // slot within the day is preserved so the route order survives an edit.
  const newDayKey = toAppZoneDayKey(newDateIso);
  const currentDayKey = dayKeyInAppZone(existing.plannedStartDateTime);
  let plannedStart = existing.plannedStartDateTime;
  let plannedEnd: Date | undefined;
  if (newDayKey !== currentDayKey) {
    plannedStart = await nextSlotForDay(user.id, newDayKey);
    plannedEnd = new Date(plannedStart.getTime() + SLOT_MS);
  }

  const skipped = data.obsSkipReason != null;

  // Whether the visit could hold observations before this edit and after it.
  // Mode is not editable here, so only who was seen and the skip reason move.
  const wasObserving = canHoldObservations(existing);
  const nowObserving = canHoldObservations({
    mode: existing.mode,
    visitedWith: data.visitedWith ?? existing.visitedWith,
    obsSkipReason: data.obsSkipReason !== undefined ? data.obsSkipReason : existing.obsSkipReason,
  });

  // An older bundle's single observation. It only ever knew one, so it is
  // read as a change to the FIRST observation and leaves any others alone —
  // replacing the whole list with it would silently delete the second class
  // somebody rated from a newer phone.
  const legacyPatch = data.observations === undefined ? legacyEditPatch(data) : null;

  const visit = await prisma.$transaction(async (tx) => {
    const updated = await tx.visit.update({
      where: { id },
      data: {
        plannedStartDateTime: plannedStart,
        ...(plannedEnd ? { plannedEndDateTime: plannedEnd } : {}),
        ...(data.notes !== undefined ? { reason: data.notes || "Manual logging" } : {}),
        ...(data.vehicle !== undefined ? { vehicle: data.vehicle } : {}),
        ...(data.visitedWith !== undefined ? { visitedWith: data.visitedWith } : {}),
        ...(data.principalNotes !== undefined ? { principalNotes: data.principalNotes || null } : {}),
        ...(data.hasInstrumentRequest !== undefined
          ? {
              hasInstrumentRequest: data.hasInstrumentRequest,
              instrumentRequestDetails: data.hasInstrumentRequest
                ? data.instrumentRequestDetails || null
                : null,
            }
          : {}),
        ...(data.obsSkipReason !== undefined
          ? { obsSkipReason: data.obsSkipReason, obsSkipNotes: skipped ? data.obsSkipNotes || null : null }
          : {}),
      },
    });

    if (!nowObserving) {
      // Observations and a skip reason are mutually exclusive, so setting one
      // clears the other — otherwise correcting a mislabelled visit would
      // leave stale ratings sitting behind the reason. Same for unticking the
      // YMU teacher or anything else that stops this being an observation.
      //
      // Only when the edit is what changed that. A visit that never was an
      // observation can still carry the programme migrated from the old
      // columns, and fixing its mileage must not erase it.
      if (wasObserving) await tx.visitObservation.deleteMany({ where: { visitId: id } });
    } else if (data.observations !== undefined) {
      await replaceVisitObservations(tx, id, data.observations);
    } else if (legacyPatch) {
      const first = existing.observations[0];
      if (first) {
        await tx.visitObservation.update({ where: { id: first.id }, data: legacyPatch });
      } else if (observationHasContent(legacyPatch as ObservationInput)) {
        await tx.visitObservation.create({ data: { visitId: id, ...legacyPatch } });
      }
    }
    return updated;
  });
  // #56: keep the teacher's Evaluations in YMU-A in step with this visit.
  after(() => syncEvaluationToYmua(prisma, visit.id).then(() => undefined));
  return serializeVisit(visit);
}

/**
 * Who actually teaches at a school, and what they teach there.
 *
 * Teacher.schoolId is a single column, so it can only ever name one school —
 * whichever the import found busiest. Reading the list from it hid every teacher
 * whose main school is elsewhere: Carrie P. Meek showed Cristian Perez and not
 * Kevin Bodniza, though the two split Modern Band and Music Production there.
 *
 * The classes are the real answer, so they are what this reads. Teachers added
 * by hand carry no classes yet and would vanish from their own school's list, so
 * they are unioned in.
 */
/**
 * The programmes a school runs, one row each — not one row per weekday.
 *
 * The master schedule is written as a programme per line: "Benjamin Franklin,
 * Drumline I, 8:48-10:10, A days, Reinaldo Velez". Listing every dated instance
 * turned that into ten near-identical rows saying the same thing, which is
 * unreadable on a card and hides the shape of the week.
 *
 * So it collapses to subject + teacher, with the time slots underneath: most
 * schools shift on Wednesdays, and the master sheet notes that the same way
 * ("8:48-10:10 Wed 8:45-9:51").
 *
 * The A/B pattern is not stored anywhere, so it isn't invented — what is shown
 * is which weekdays a slot actually falls on, counted from the calendar.
 */
export async function getSchoolWeeklySchedules(schoolIds: string[]) {
  const session = await auth();
  requireUser(session);
  if (schoolIds.length === 0) return {};

  const firstQuarter = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });

  // The master spreadsheet's own words, shown alongside. Reference only — it is
  // matched to a programme by name and never relied on for anything.
  const noteRows = await prisma.programScheduleNote.findMany({
    where: { schoolId: { in: schoolIds } },
    orderBy: { sourceRow: "asc" },
  });
  const noteKey = (schoolId: string, subject: string) =>
    `${schoolId}|${subject.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const notesByProgramme = new Map<string, typeof noteRows>();
  for (const n of noteRows) {
    const k = noteKey(n.schoolId, n.subjectName);
    notesByProgramme.set(k, [...(notesByProgramme.get(k) ?? []), n]);
  }

  const sessions = await prisma.classSession.findMany({
    where: {
      schoolId: { in: schoolIds },
      ...(firstQuarter ? { startDateTime: { gte: firstQuarter.startDate } } : {}),
    },
    select: {
      schoolId: true,
      startDateTime: true,
      endDateTime: true,
      subject: { select: { name: true } },
      teacher: { select: { id: true, name: true, externalId: true } },
    },
    orderBy: { startDateTime: "asc" },
  });

  const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  type TimeSlot = { start: string; end: string; days: string[]; occurrences: number };
  type Programme = {
    subject: string;
    teacherName: string | null;
    teacherId: string | null;
    slots: TimeSlot[];
    occurrences: number;
    /** Weekdays this programme runs at all, in week order. */
    days: string[];
    /**
     * "weekly" when it runs on its weekdays every week, "alternating" when it
     * runs roughly every other one — which is what the master schedule calls A
     * days and B days. Counted from the dates rather than labelled A or B,
     * because nothing in the data says which letter a school considers itself
     * on, and a guessed label reads as fact.
     */
    cadence: "weekly" | "alternating";
    /**
     * How the master spreadsheet words it — "A days", "B days", "Odd dates of
     * the month". Display text only; the calendar remains the source of truth
     * for when a class actually is.
     */
    sheetDayPatterns: string[];
    sheetPeriods: string[];
    dates: Set<string>;
  };

  const byProgramme = new Map<string, Programme>();

  for (const s of sessions) {
    const weekdayLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIME_ZONE,
      weekday: "short",
    }).format(s.startDateTime);
    const start = formatTimeInAppZone(s.startDateTime);
    const end = formatTimeInAppZone(s.endDateTime);
    // A real teacher only — a leftover calendar row is a school name, not a person.
    const teacher = s.teacher?.externalId ? s.teacher : null;

    const key = `${s.schoolId}|${s.subject.name}|${teacher?.id ?? ""}`;
    const programme =
      byProgramme.get(key) ??
      {
        schoolId: s.schoolId,
        subject: s.subject.name,
        teacherName: teacher?.name ?? null,
        teacherId: teacher?.id ?? null,
        slots: [] as TimeSlot[],
        occurrences: 0,
        days: [] as string[],
        cadence: "weekly" as const,
        sheetDayPatterns: [] as string[],
        sheetPeriods: [] as string[],
        dates: new Set<string>(),
      };
    programme.occurrences += 1;
    programme.dates.add(dayKeyInAppZone(s.startDateTime));
    if (!programme.days.includes(weekdayLabel)) programme.days.push(weekdayLabel);

    const slot = programme.slots.find((t) => t.start === start && t.end === end);
    if (slot) {
      slot.occurrences += 1;
      if (!slot.days.includes(weekdayLabel)) slot.days.push(weekdayLabel);
    } else {
      programme.slots.push({ start, end, days: [weekdayLabel], occurrences: 1 });
    }
    byProgramme.set(key, programme as Programme & { schoolId: string });
  }

  // How many distinct school days the term spans, to judge a cadence against.
  const allDates = new Set(sessions.map((s) => dayKeyInAppZone(s.startDateTime)));

  const out: Record<string, Omit<Programme, "dates">[]> = {};
  for (const [key, programme] of byProgramme) {
    const schoolId = key.split("|")[0];
    // A programme running on, say, Mondays in only half the weeks is on an
    // alternating cycle. Judged per weekday so a Wednesday-only class isn't
    // mistaken for one.
    const perWeekday = new Map<string, number>();
    for (const d of programme.dates) {
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, weekday: "short" })
        .format(zonedDayStart(d));
      perWeekday.set(wd, (perWeekday.get(wd) ?? 0) + 1);
    }
    const weeksInTerm = new Set(
      [...allDates].map((d) => mondayOfDayKey(d))
    ).size;
    const ratios = [...perWeekday.values()].map((n) => n / Math.max(1, weeksInTerm));
    const typical = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
    programme.cadence = typical < 0.75 ? "alternating" : "weekly";

    const matched = notesByProgramme.get(noteKey(schoolId, programme.subject)) ?? [];
    programme.sheetDayPatterns = [
      ...new Set(matched.map((m) => m.dayPattern).filter((d): d is string => !!d)),
    ];
    programme.sheetPeriods = [
      ...new Set(matched.map((m) => m.period).filter((p): p is string => !!p)),
    ];
    const sortDays = (d: string[]) => d.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
    programme.days = sortDays(programme.days);
    // The dominant slot first; a Wednesday variant reads as the exception it is.
    programme.slots = programme.slots
      .map((t) => ({ ...t, days: sortDays(t.days) }))
      .sort((a, b) => b.occurrences - a.occurrences || a.start.localeCompare(b.start));
    const { dates: _dates, ...rest } = programme;
    void _dates;
    (out[schoolId] ||= []).push(rest);
  }

  for (const list of Object.values(out)) {
    list.sort(
      (a, b) => (a.slots[0]?.start ?? "").localeCompare(b.slots[0]?.start ?? "") ||
        a.subject.localeCompare(b.subject)
    );
  }
  return out;
}

/**
 * A school's own page: its timetable, who teaches it, and what past visits
 * found there.
 *
 * The visit form's answers — the conversation with a principal, a teacher's
 * ratings, an instrument request — were only ever reachable from the flat Visit
 * History list, mixed in with every other school. Reading them before walking
 * into a school is the point of having recorded them.
 */
export async function getSchoolProfile(schoolId: string) {
  const session = await auth();
  const user = requireUser(session);

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { region: { select: { name: true } } },
  });
  if (!school) return null;

  const statusChangedBy = school.statusChangedById
    ? await prisma.user.findUnique({ where: { id: school.statusChangedById }, select: { name: true, email: true } })
    : null;

  const [schedules, teachers, visits] = await Promise.all([
    getSchoolWeeklySchedules([schoolId]),
    getSchoolTeachers(schoolId),
    prisma.visit.findMany({
      where: { schoolId, status: "DONE" },
      include: {
        visitedBy: { select: { name: true, email: true } },
        observations: { include: observationInclude, orderBy: observationOrder },
      },
      orderBy: { plannedStartDateTime: "desc" },
      take: 25,
    }),
  ]);

  return {
    school: {
      id: school.id,
      name: school.name,
      address: school.address,
      zipCode: school.zipCode,
      regionName: school.region?.name ?? null,
      lat: school.lat,
      lng: school.lng,
      isOffice: school.isOffice,
      // #64
      status: school.status,
      statusReason: school.statusReason,
      statusChangedKey: school.statusChangedAt ? dayKeyInAppZone(school.statusChangedAt) : null,
      statusChangedBy: statusChangedBy?.name ?? statusChangedBy?.email ?? null,
      canChangeStatus: !school.isOffice && canChangeSchoolStatus(user, school),
    },
    schedule: schedules[schoolId] ?? [],
    teachers,
    // Only this user's own visits carry their notes; an RM seeing another
    // region's school still sees that it was visited, by whom, and when.
    visits: visits.map((v) => ({
      id: v.id,
      date: v.plannedStartDateTime,
      mode: v.mode,
      vehicle: v.vehicle,
      notes: v.reason,
      visitedByName: v.visitedBy?.name ?? v.visitedBy?.email ?? null,
      isMine: v.visitedById === user.id,
      milesDriven: decimalToNumber(v.milesDriven),
      returnMilesDriven: decimalToNumber(v.returnMilesDriven),
      commuteMiles: decimalToNumber(v.commuteMiles),
      returnCommuteMiles: decimalToNumber(v.returnCommuteMiles),
      originLabel: v.originLabel,
      visitedWith: v.visitedWith,
      principalNotes: v.principalNotes,
      observations: v.observations.map(serializeObservation),
      obsSkipReason: v.obsSkipReason,
      obsSkipNotes: v.obsSkipNotes,
      hasInstrumentRequest: v.hasInstrumentRequest,
      instrumentRequestDetails: v.instrumentRequestDetails,
      geofenceOverridden: v.geofenceOverridden,
    })),
  };
}

/**
 * One teacher: where they work, what they teach, and every observation recorded
 * of them.
 *
 * Ratings were filed against a visit, which is a visit to a *school*. Nothing
 * gathered them per teacher, so there was no way to see whether someone had
 * improved — the question the rubric exists to answer.
 */
export async function getTeacherProfile(teacherId: string) {
  const session = await auth();
  const user = requireUser(session);

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    include: { school: { select: { id: true, name: true } } },
  });
  if (!teacher) return null;

  const firstQuarter = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });

  const sessions = await prisma.classSession.findMany({
    where: {
      teacherId,
      ...(firstQuarter ? { startDateTime: { gte: firstQuarter.startDate } } : {}),
    },
    select: {
      startDateTime: true,
      endDateTime: true,
      school: { select: { id: true, name: true } },
      subject: { select: { name: true } },
    },
    orderBy: { startDateTime: "asc" },
  });

  // Where they teach and what, one row per school+subject rather than per week.
  const byKey = new Map<string, { schoolId: string; schoolName: string; subject: string; count: number }>();
  for (const s of sessions) {
    const key = `${s.school.id}|${s.subject.name}`;
    const row = byKey.get(key) ?? {
      schoolId: s.school.id,
      schoolName: s.school.name,
      subject: s.subject.name,
      count: 0,
    };
    row.count += 1;
    byKey.set(key, row);
  }
  const assignments = [...byKey.values()].sort(
    (a, b) => a.schoolName.localeCompare(b.schoolName) || a.subject.localeCompare(b.subject)
  );
  const schoolIds = [...new Set(sessions.map((s) => s.school.id))];

  // Every observation that names this teacher — one per class watched, so a
  // visit that also rated the teacher next door contributes only this
  // teacher's ratings and notes, never the other's.
  const mine = await prisma.visitObservation.findMany({
    where: { teacherId, visit: { status: "DONE" } },
    include: {
      ...observationInclude,
      visit: {
        include: {
          school: { select: { id: true, name: true } },
          visitedBy: { select: { name: true, email: true } },
        },
      },
    },
  });

  // Older visits recorded only the school; those are still shown, marked as
  // unattributed, because dropping them would lose the history they hold — but
  // they are the reason a school with two teachers shows the same visit twice.
  // "Unattributed" now means no observation on the visit names anyone: once
  // one does, the visit belongs to that teacher and not to everybody here.
  const unattributed = schoolIds.length
    ? await prisma.visit.findMany({
        where: {
          status: "DONE",
          schoolId: { in: schoolIds },
          visitedWith: { has: "YMU_TEACHER" },
          observations: { none: { teacherId: { not: null } } },
        },
        include: {
          school: { select: { id: true, name: true } },
          visitedBy: { select: { name: true, email: true } },
          observations: { include: observationInclude, orderBy: observationOrder },
        },
      })
    : [];

  type ProfileVisit = (typeof unattributed)[number] | (typeof mine)[number]["visit"];
  const row = (
    v: ProfileVisit,
    o: ReturnType<typeof serializeObservation> | null,
    attributed: boolean,
  ) => ({
    // An observation's own id, or the visit's when it has none to show.
    id: o?.id ?? v.id,
    visitId: v.id,
    date: v.plannedStartDateTime,
    schoolId: v.school.id,
    schoolName: v.school.name,
    visitedByName: v.visitedBy?.name ?? v.visitedBy?.email ?? null,
    isMine: v.visitedById === user.id,
    mode: v.mode,
    // False for older visits that recorded only the school.
    attributed,
    subjectName: o?.subjectName ?? null,
    ratings: o?.ratings ?? {
      obsPlanningPrep: null,
      obsCultureManagement: null,
      obsInstructionMusicianship: null,
      obsEngagementEvidence: null,
      obsProfessionalismGrowth: null,
    },
    notes: o?.notes ?? null,
    obsSkipReason: v.obsSkipReason,
    obsSkipNotes: v.obsSkipNotes,
    principalNotes: v.principalNotes,
  });

  const observations = [
    ...mine.map((o) => row(o.visit, serializeObservation(o), true)),
    ...unattributed.flatMap((v) =>
      v.observations.length
        ? v.observations.map((o) => row(v, serializeObservation(o), false))
        : [row(v, null, false)],
    ),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    teacher: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      subjects: teacher.subjects,
      fromYmuA: teacher.externalId != null,
      primarySchool: teacher.school,
    },
    assignments,
    classCount: sessions.length,
    schoolCount: schoolIds.length,
    // True when a school this teacher works has another too, which is what makes
    // an observation there ambiguous.
    observations,
  };
}

export async function getSchoolTeachers(schoolId: string, onDateIso?: string) {
  requireUser(await auth());
  // Last year's classes are still in the database. Counting them here would
  // credit a teacher with a school they no longer serve, and inflate the class
  // counts with a year nobody is planning against.
  const firstQuarter = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });
  const yearStart = firstQuarter?.startDate;

  // Several schools alternate two classes through the same slot — Charles R.
  // Drew runs Drumline one day and Beginning Band the next, with a different
  // teacher each. Knowing the date settles which of them was actually taught,
  // so a visit being logged for that date can default to the right person.
  let taughtThatDay = new Set<string>();
  if (onDateIso) {
    const dayKey = toAppZoneDayKey(onDateIso);
    const dayStart = zonedDayStart(dayKey);
    const dayEnd = zonedDayStart(addDaysToDayKey(dayKey, 1));
    const onDay = await prisma.classSession.findMany({
      where: { schoolId, startDateTime: { gte: dayStart, lt: dayEnd }, teacherId: { not: null } },
      select: { teacherId: true },
    });
    taughtThatDay = new Set(onDay.map((c) => c.teacherId!).filter(Boolean));
  }

  const [sessions, byField] = await Promise.all([
    prisma.classSession.findMany({
      where: {
        schoolId,
        teacherId: { not: null },
        ...(yearStart ? { startDateTime: { gte: yearStart } } : {}),
      },
      select: {
        teacher: { select: { id: true, name: true, email: true, subjects: true, externalId: true } },
        subject: { select: { name: true } },
      },
    }),
    prisma.teacher.findMany({
      where: { schoolId },
      select: { id: true, name: true, email: true, subjects: true, externalId: true },
    }),
  ]);

  type Row = {
    id: string;
    name: string;
    email: string | null;
    subjects: string | null;
    externalId: string | null;
    subjectsHere: string[];
    classCount: number;
    /** Had a class at this school on the date asked about, if one was given. */
    teachingOnDate: boolean;
  };
  const byId = new Map<string, Row>();

  for (const s of sessions) {
    if (!s.teacher) continue;
    const row =
      byId.get(s.teacher.id) ??
      {
        ...s.teacher,
        subjectsHere: [] as string[],
        classCount: 0,
        teachingOnDate: taughtThatDay.has(s.teacher.id),
      };
    row.classCount += 1;
    if (!row.subjectsHere.includes(s.subject.name)) row.subjectsHere.push(s.subject.name);
    byId.set(s.teacher.id, row);
  }

  for (const t of byField) {
    if (!byId.has(t.id)) {
      byId.set(t.id, { ...t, subjectsHere: [], classCount: 0, teachingOnDate: taughtThatDay.has(t.id) });
    }
  }

  return [...byId.values()]
    .map((t) => ({ ...t, subjectsHere: t.subjectsHere.sort() }))
    .sort(
      (a, b) =>
        Number(b.teachingOnDate) - Number(a.teachingOnDate) ||
        b.classCount - a.classCount ||
        a.name.localeCompare(b.name)
    );
}

/**
 * The programmes taught at a school, for the Log/Edit Visit form's programme
 * picker.
 *
 * Shaped like getSchoolTeachers above and for the same reason: several schools
 * alternate two programmes through the same slot, so the date is what settles
 * which was actually running. What it cannot settle is a day that ran both —
 * 46 historical visits sit at exactly that school-and-day, which is why this
 * picker exists at all: the backfill refused to guess between them and a person
 * who was there can simply say.
 */
export async function getSchoolSubjects(schoolId: string, onDateIso?: string) {
  requireUser(await auth());
  const firstQuarter = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });
  const yearStart = firstQuarter?.startDate;

  let taughtThatDay = new Set<string>();
  if (onDateIso) {
    const dayKey = toAppZoneDayKey(onDateIso);
    const dayStart = zonedDayStart(dayKey);
    const dayEnd = zonedDayStart(addDaysToDayKey(dayKey, 1));
    const onDay = await prisma.classSession.findMany({
      where: { schoolId, startDateTime: { gte: dayStart, lt: dayEnd } },
      select: { subjectId: true },
    });
    taughtThatDay = new Set(onDay.map((c) => c.subjectId));
  }

  const sessions = await prisma.classSession.findMany({
    where: { schoolId, ...(yearStart ? { startDateTime: { gte: yearStart } } : {}) },
    select: { subjectId: true, subject: { select: { name: true } } },
  });

  const byId = new Map<string, { id: string; name: string; classCount: number; taughtOnDate: boolean }>();
  for (const c of sessions) {
    const row =
      byId.get(c.subjectId) ??
      { id: c.subjectId, name: c.subject.name, classCount: 0, taughtOnDate: taughtThatDay.has(c.subjectId) };
    row.classCount += 1;
    byId.set(c.subjectId, row);
  }

  return [...byId.values()].sort(
    (a, b) =>
      Number(b.taughtOnDate) - Number(a.taughtOnDate) ||
      b.classCount - a.classCount ||
      a.name.localeCompare(b.name)
  );
}

/**
 * What the "Which classes did you observe?" checklist offers, for one school
 * on one day.
 *
 * A class here is a programme and its teacher — "Drumline — Yailin Ayala" —
 * because that pair is what an observation is about. Carol City MS and North
 * Dade run two at the same time in the same building, which is the whole
 * reason the form became a checklist (Eric Levy, 2026-10-15): both appear, and
 * the RM ticks each one they stood in.
 *
 * The day's own classes when the calendar has any. When it has none — a visit
 * logged for a day the sync never saw, a cancelled timetable — the pairs this
 * school ran this year instead, marked as not on the calendar that day, so the
 * list is never empty for a school YMU actually teaches at.
 *
 * Teacherless sessions are left out of the checklist: an evaluation goes to a
 * teacher, and a class with nobody on it would be a box that shares with no
 * one. The teacher and programme lists returned alongside are what the form's
 * "Other / not listed" path picks from, so nothing the old separate pickers
 * allowed has become impossible.
 */
export async function getObservationChoices(schoolId: string, onDateIso: string) {
  requireUser(await auth());
  const dayKey = toAppZoneDayKey(onDateIso);
  const dayStart = zonedDayStart(dayKey);
  const dayEnd = zonedDayStart(addDaysToDayKey(dayKey, 1));

  const sessionSelect = {
    startDateTime: true,
    endDateTime: true,
    subjectId: true,
    teacherId: true,
    subject: { select: { name: true } },
    teacher: { select: { name: true } },
  } as const;

  let ranOnDate = true;
  let sessions = await prisma.classSession.findMany({
    where: { schoolId, teacherId: { not: null }, startDateTime: { gte: dayStart, lt: dayEnd } },
    select: sessionSelect,
    orderBy: { startDateTime: "asc" },
  });
  if (sessions.length === 0) {
    ranOnDate = false;
    const firstQuarter = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });
    sessions = await prisma.classSession.findMany({
      where: {
        schoolId,
        teacherId: { not: null },
        ...(firstQuarter ? { startDateTime: { gte: firstQuarter.startDate } } : {}),
      },
      select: sessionSelect,
      orderBy: { startDateTime: "asc" },
    });
  }

  const byPair = new Map<
    string,
    { subjectId: string; subjectName: string; teacherId: string; teacherName: string; times: string[]; ranOnDate: boolean }
  >();
  for (const c of sessions) {
    if (!c.teacherId || !c.teacher) continue;
    const key = `${c.subjectId}|${c.teacherId}`;
    const row = byPair.get(key) ?? {
      subjectId: c.subjectId,
      subjectName: c.subject.name,
      teacherId: c.teacherId,
      teacherName: c.teacher.name,
      times: [] as string[],
      ranOnDate,
    };
    // The time is what tells two same-named sections apart at a glance; a
    // year's worth of them would just be noise.
    if (ranOnDate) {
      const t = `${formatTimeInAppZone(c.startDateTime)}–${formatTimeInAppZone(c.endDateTime)}`;
      if (!row.times.includes(t)) row.times.push(t);
    }
    byPair.set(key, row);
  }

  const [teachers, subjects] = await Promise.all([
    getSchoolTeachers(schoolId, onDateIso),
    getSchoolSubjects(schoolId, onDateIso),
  ]);

  return {
    classes: [...byPair.values()].sort(
      (a, b) =>
        (a.times[0] ?? "").localeCompare(b.times[0] ?? "") ||
        a.subjectName.localeCompare(b.subjectName) ||
        a.teacherName.localeCompare(b.teacherName),
    ),
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.name,
      subjectsHere: t.subjectsHere,
      teachingOnDate: t.teachingOnDate,
    })),
    subjects: subjects.map((sub) => ({ id: sub.id, name: sub.name, taughtOnDate: sub.taughtOnDate })),
  };
}

export async function createTeacher(schoolId: string, data: { name: string; subjects?: string }) {
  const session = await auth();
  const user = requireUser(session);
  if (!canManageSchoolData(user)) {
    throw new Error("Forbidden: this role cannot edit school records");
  }

  return await prisma.teacher.create({
    data: {
      school: { connect: { id: schoolId } },
      name: data.name,
      subjects: data.subjects ?? null,
    },
  });
}

export async function updateTeacher(teacherId: string, data: { name?: string; subjects?: string }) {
  const session = await auth();
  const user = requireUser(session);
  if (!canManageSchoolData(user)) {
    throw new Error("Forbidden: this role cannot edit school records");
  }

  return await prisma.teacher.update({
    where: { id: teacherId },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.subjects != null ? { subjects: data.subjects } : {}),
    },
  });
}

export async function deleteTeacher(teacherId: string) {
  const session = await auth();
  const user = requireUser(session);
  if (!canManageSchoolData(user)) {
    throw new Error("Forbidden: this role cannot edit school records");
  }

  return await prisma.teacher.delete({ where: { id: teacherId } });
}

// ─── VisitRule actions ─────────────────────────────────────────────────────────

const visitRuleSchema = z.object({
  frequencyType: z.enum(["WEEKLY", "BIWEEKLY", "EVERY_3_WEEKS", "MONTHLY"]),
  reason: z.string().max(500).optional(),
  effectiveFrom: z.string().optional(), // ISO date string
});

export async function getVisitRulesForSchool(schoolId: string) {
  requireUser(await auth());
  return await prisma.visitRule.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createVisitRule(schoolId: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);
  if (!canManageSchoolData(user)) {
    throw new Error("Forbidden: this role cannot edit school records");
  }

  const parsed = visitRuleSchema.safeParse(formData);
  if (!parsed.success) throw new Error(parsed.error.message);

  const { frequencyType, reason, effectiveFrom } = parsed.data;

  // Archive any currently active rule for this school
  await prisma.visitRule.updateMany({
    where: { schoolId, effectiveTo: null },
    data: { effectiveTo: new Date() },
  });

  return await prisma.visitRule.create({
    data: {
      schoolId,
      frequencyType,
      reason: reason ?? null,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      effectiveTo: null,
    },
  });
}

export async function archiveVisitRule(ruleId: string) {
  const session = await auth();
  const user = requireUser(session);
  if (!canManageSchoolData(user)) {
    throw new Error("Forbidden: this role cannot edit school records");
  }
  return await prisma.visitRule.update({
    where: { id: ruleId },
    data: { effectiveTo: new Date() },
  });
}

export async function updateVisitRule(ruleId: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);
  if (!canManageSchoolData(user)) {
    throw new Error("Forbidden: this role cannot edit school records");
  }

  const parsed = visitRuleSchema.safeParse(formData);
  if (!parsed.success) throw new Error(parsed.error.message);

  const { frequencyType, reason, effectiveFrom } = parsed.data;
  return await prisma.visitRule.update({
    where: { id: ruleId },
    data: {
      frequencyType,
      reason: reason ?? null,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
    },
  });
}

// ─── Route optimization (Phase 2b) ────────────────────────────────────────────

export type DayRouteResult = Awaited<ReturnType<typeof getOptimalRouteForDay>>;

export async function getOptimalRouteForDay(
  dateIso: string,
  schoolIds: string[],
  startLocation: StartLocationInput,
  options?: {
    manualOrder?: string[];
    departureTime?: string;
    reoptimize?: boolean;
    /**
     * schoolId -> "HH:mm" of the class this stop is aimed at. Sent by the map
     * from the week's plan, because the plan is what knows which class each
     * visit was for; this function only has school ids.
     */
    classTimes?: Record<string, string>;
    strategy?: "class-time" | "shortest-drive";
  }
) {
  const session = await auth();
  const user = requireUser(session);

  if (!process.env.OPENROUTE_SERVICE_API_KEY) {
    throw new Error("OPENROUTE_SERVICE_API_KEY is not configured");
  }

  if (schoolIds.length === 0) {
    throw new Error("Select at least one school to visit");
  }

  // The office is region-less on purpose — it serves every region — so a plain
  // region filter would reject it as "not in your region" and refuse to route a
  // day that stops there, which is most days.
  const baseWhere = schoolRegionWhere(user);
  const schools = await prisma.school.findMany({
    where: {
      id: { in: schoolIds },
      active: true,
      ...(baseWhere.regionId !== undefined
        ? { OR: [{ regionId: baseWhere.regionId }, { isOffice: true }] }
        : {}),
    },
  });

  if (schools.length !== schoolIds.length) {
    const foundIds = new Set(schools.map((s) => s.id));
    const missingIds = schoolIds.filter((id) => !foundIds.has(id));
    // Missing IDs usually mean stale localStorage references to schools that were
    // deleted or moved to a different region. Refreshing the weekly plan clears them.
    throw new Error(
      `${missingIds.length} school(s) not found or not in your region. ` +
      `Try refreshing the weekly plan. Missing IDs: ${missingIds.join(", ")}`
    );
  }

  const missingCoords = schools.filter((s) => s.lat == null || s.lng == null);
  if (missingCoords.length > 0) {
    throw new Error(
      `Missing coordinates for: ${missingCoords.map((s) => s.name).join(", ")}`
    );
  }

  let start: { lat: number; lng: number; label?: string };
  if (startLocation.type === "coordinates") {
    start = {
      lat: startLocation.lat,
      lng: startLocation.lng,
      label: startLocation.label,
    };
  } else {
    const geocoded = await geocodeAddress(startLocation.address);
    start = geocoded;
  }

  const stopInputs = schools.map((s) => ({
    schoolId: s.id,
    schoolName: s.name,
    lat: s.lat!,
    lng: s.lng!,
    classTime: options?.classTimes?.[s.id],
  }));

  const departureTime = options?.departureTime ?? "08:00";
  const useManualOrder =
    options?.manualOrder &&
    options.manualOrder.length === schoolIds.length &&
    !options.reoptimize;

  let route;
  if (useManualOrder) {
    const orderMap = new Map(stopInputs.map((s) => [s.schoolId, s]));
    const orderedStops = options.manualOrder!.map((id) => {
      const stop = orderMap.get(id);
      if (!stop) throw new Error(`Unknown school in manual order: ${id}`);
      return stop;
    });
    route = await computeRouteForOrder(prisma, start, orderedStops, departureTime);
  } else {
    route = await optimizeRoute(
      prisma,
      start,
      stopInputs,
      departureTime,
      options?.strategy ?? "class-time"
    );
  }

  const waypoints = [
    { lat: route.start.lat, lng: route.start.lng },
    ...route.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
  const polyline = await getDrivingPolyline(waypoints);

  return {
    date: dateIso,
    ...route,
    polyline,
  };
}

// ─── Home location (per-user, used for mileage/route origin) ────────────────

/**
 * Regional managers a report can be filtered down to.
 *
 * An RM sees the others in their own region (they cover for each other and
 * need to reconcile shared days); admins see everyone. Anyone else gets only
 * themselves, so the picker can never become a directory of other people's
 * mileage.
 */
export async function getReportableUsers() {
  const session = await auth();
  const user = requireUser(session);

  if (!canSeeOthersReports(user.role)) {
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true },
    });
    return me ? [me] : [];
  }

  return await prisma.user.findMany({
    where: seesAllRegions(user.role) ? {} : { regionId: user.regionId ?? undefined },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}

/** On-screen mileage report. Same data the CSV/PDF download renders. */
export async function getMileageReport(params: {
  preset: RangePreset;
  quarterKey?: string | null;
  start?: string | null;
  end?: string | null;
  regionId?: string | null;
  userId?: string | null;
}) {
  const session = await auth();
  const user = requireUser(session);

  const regionId = canFilterByRegion(user.role) ? params.regionId ?? undefined : scopeToRegion(user);
  const canSeeOthers = canSeeOthersReports(user.role);
  const visitedById = canSeeOthers ? params.userId ?? undefined : user.id;

  const range = await resolveRange(prisma, params.preset, {
    quarterKey: params.quarterKey,
    start: params.start,
    end: params.end,
  });

  const data = await getMileageReportData(prisma, {
    startDate: range.startDate,
    endDate: range.endDate,
    label: range.label,
    regionId,
    visitedById,
  });

  // Dates cross to the client fine; the Decimals were already converted upstream.
  return {
    ...data,
    period: {
      label: data.period.label,
      startDate: data.period.startDate.toISOString(),
      endDate: data.period.endDate.toISOString(),
    },
    visits: data.visits.map((v) => ({ ...v, date: v.date.toISOString() })),
  };
}

export async function getQuarters() {
  return await prisma.quarter.findMany({ orderBy: { startDate: "asc" } });
}

export async function getMyHomeLocation() {
  const session = await auth();
  const user = requireUser(session);
  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { homeAddress: true, homeLat: true, homeLng: true },
  });
  if (!record?.homeAddress || record.homeLat == null || record.homeLng == null) return null;
  return { address: record.homeAddress, lat: record.homeLat, lng: record.homeLng };
}

export async function setMyHomeLocation(address: string) {
  const session = await auth();
  const user = requireUser(session);

  const trimmed = address.trim();
  if (!trimmed) throw new Error("Address is required");

  const { lat, lng } = await geocodeAddress(trimmed);
  await prisma.user.update({
    where: { id: user.id },
    data: { homeAddress: trimmed, homeLat: lat, homeLng: lng },
  });
  return { address: trimmed, lat, lng };
}

/**
 * Rewrite the export spreadsheet now, instead of waiting for tonight's cron.
 *
 * The cron runs once a day, which is the right cadence for a dataset nobody
 * watches live and the wrong one the moment somebody is looking. Whoever asked
 * "why isn't this visit in the sheet" has, up to now, had no answer but "wait
 * until tomorrow" — so here is the button that answers it.
 *
 * Oversight and app admins only. Not because a refresh is dangerous — it
 * rewrites an export from the database and cannot change the app — but because
 * it is one request per tab against a 60-per-minute write quota, and the people
 * who read the sheet are the people who need it fresh. An RM confirming a visit
 * does not need to repaint eleven tabs to do so.
 */
export async function syncExportSheet() {
  const session = await auth();
  const user = requireUser(session);
  if (!OVERSIGHT_ROLES.includes(user.role) && !canAdministerApp(user)) {
    throw new Error("Forbidden: this role cannot refresh the export");
  }

  const result = await syncDatasetToSheet(prisma);
  return {
    syncedAt: new Date().toISOString(),
    url: `https://docs.google.com/spreadsheets/d/${result.sheetId}/edit`,
    tables: result.tables,
  };
}

// ─── Weekly plan → the RM's own Google Calendar (FR-043) ────────────────────

const calendarVisitInput = z.object({
  schoolId: z.string().min(1),
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  subjectName: z.string().max(200).optional(),
  teacherName: z.string().max(200).optional(),
  /** The class period, so a visit re-sent with another window moves its event. */
  classStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  classEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/**
 * Sends the week on the planner's screen to the signed-in user's Google
 * Calendar. The plan is posted by the client because that is where it lives —
 * the planner computes it per visit and keeps hand edits in the browser — but
 * everything that ends up on the event (school name, address) is read here,
 * and the calendar written to is always the session's own.
 */
export async function sendWeekToGoogleCalendar(
  weekKey: string,
  rawVisits: unknown,
  /** What this send covers: the week (default), one day, or one visit. */
  scope: { kind: "week" } | { kind: "day"; dayKey: string } | { kind: "visit" } = { kind: "week" },
) {
  const session = await auth();
  const user = requireUser(session);
  if (!canPlanVisits(user.role)) throw new Error("Forbidden: this role does not plan visits");
  if (!user.email) return { ok: false as const, error: "Your account has no email address." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey) || mondayOfDayKey(weekKey) !== weekKey) {
    return { ok: false as const, error: "That is not the start of a week." };
  }
  const parsed = z.array(calendarVisitInput).max(80).safeParse(rawVisits);
  if (!parsed.success) return { ok: false as const, error: "The plan sent was not readable." };

  const weekDays = new Set(Array.from({ length: 7 }, (_, i) => addDaysToDayKey(weekKey, i)));
  const visits = parsed.data.filter(
    (v) => weekDays.has(v.dayKey) && (scope.kind !== "day" || v.dayKey === scope.dayKey),
  );
  if (scope.kind === "visit" && visits.length !== 1) {
    return { ok: false as const, error: "Pick one visit to send." };
  }
  if (scope.kind === "day" && !weekDays.has(scope.dayKey)) {
    return { ok: false as const, error: "That day is not in this week." };
  }
  // Removal follows the scope — see syncWeekToCalendar.
  const removeWithinDays: Set<string> =
    scope.kind === "week" ? weekDays : scope.kind === "day" ? new Set([scope.dayKey]) : new Set();

  const schools = await prisma.school.findMany({
    where: { id: { in: [...new Set(visits.map((v) => v.schoolId))] } },
    select: { id: true, name: true, address: true, zipCode: true },
  });
  const schoolById = new Map(schools.map((s) => [s.id, s]));

  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const fromMinutes = (m: number) =>
    `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const calendarVisits = visits.flatMap((v) => {
    const school = schoolById.get(v.schoolId);
    if (!school) return [];
    const start = toMinutes(v.startTime);
    // A slot with no end, or one that ends before it starts, gets the
    // planner's standard half hour.
    const end = v.endTime && toMinutes(v.endTime) > start ? toMinutes(v.endTime) : start + 30;
    const details = [
      v.subjectName ? `Class: ${v.subjectName}` : null,
      v.teacherName ? `Teacher: ${v.teacherName}` : null,
      "Planned in the YMU Visit Planner. Re-sending the week from the planner updates or removes this event.",
    ].filter(Boolean);
    return [
      {
        key: `${v.schoolId}|${v.dayKey}|${v.startTime}`,
        dayKey: v.dayKey,
        startTime: fromMinutes(start),
        endTime: fromMinutes(end),
        summary: `Visit ${school.name} | YMU`,
        location: school.address?.trim() || null,
        description: details.join("\n"),
        slot: v.classStart && v.classEnd && v.classEnd > v.classStart ? { start: v.classStart, end: v.classEnd } : undefined,
      },
    ];
  });

  return syncWeekToCalendar(user.email, weekKey, calendarVisits, removeWithinDays);
}

// ─── School status: active, on hold, inactive (#64) ─────────────────────────

const schoolStatusInput = z.object({
  schoolId: z.string().min(1),
  status: z.enum(["ACTIVE", "ON_HOLD", "INACTIVE"]),
  reason: z.string().max(500).optional(),
});

/**
 * Puts a school on hold, marks it inactive, or brings it back. Admin,
 * Operations, and the Regional Manager of the school's region. Coming back to
 * ACTIVE stamps activeSince, so its cadence starts from today rather than
 * calling it overdue or never visited the moment it returns.
 */
export async function setSchoolStatus(input: unknown) {
  const user = requireUser(await auth());
  const parsed = schoolStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "That status change was not readable." };
  const { schoolId, status, reason } = parsed.data;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, regionId: true, status: true, isOffice: true },
  });
  if (!school || school.isOffice) return { ok: false as const, error: "School not found." };
  if (!canChangeSchoolStatus(user, school)) {
    return { ok: false as const, error: "Only Admin, Operations or this region's Regional Manager can change that." };
  }
  if (school.status === status) return { ok: true as const };

  const now = new Date();
  await prisma.school.update({
    where: { id: schoolId },
    data: {
      status,
      statusReason: status === "ACTIVE" ? null : reason?.trim() || null,
      statusChangedAt: now,
      statusChangedById: user.id,
      ...(status === "ACTIVE" ? { activeSince: now, holdSuggestionSnoozedUntil: null } : {}),
    },
  });
  return { ok: true as const };
}

/** "Not now" on a hold suggestion: hidden for 30 days, then asked again. */
export async function snoozeHoldSuggestion(schoolId: string) {
  const user = requireUser(await auth());
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { regionId: true } });
  if (!school || !canChangeSchoolStatus(user, school)) return { ok: false as const };
  await prisma.school.update({
    where: { id: schoolId },
    data: { holdSuggestionSnoozedUntil: addDays(new Date(), 30) },
  });
  return { ok: true as const };
}

// ─── Drive times between a day's visits (#62, point 1) ──────────────────────

/**
 * Real driving minutes between the schools of each planned day, for the
 * calendar windows: whether the last 20 minutes of one class and the first of
 * another can both be made. Each group is one day's schools. Same routing
 * service and per-pair cache as the planner and the map, so a pair of schools
 * is only ever asked of OpenRouteService once. Keys are "fromId|toId".
 * A day the service can't price is simply left out; the client falls back
 * to the planner's straight-line estimate and says it is an estimate.
 */
export async function getDayDriveMinutes(groups: string[][]): Promise<Record<string, number>> {
  const user = requireUser(await auth());
  if (!canPlanVisits(user.role)) return {};
  if (!process.env.OPENROUTE_SERVICE_API_KEY) return {};

  const days = groups
    .map((g) => [...new Set(g.filter((id) => typeof id === "string"))])
    .filter((g) => g.length > 1 && g.length <= 12)
    .slice(0, 7);
  if (days.length === 0) return {};

  const schools = await prisma.school.findMany({
    where: { id: { in: [...new Set(days.flat())] } },
    select: { id: true, lat: true, lng: true },
  });
  const byId = new Map(schools.filter((s) => s.lat != null && s.lng != null).map((s) => [s.id, s]));

  const minutes: Record<string, number> = {};
  const service = new OpenRouteDistanceService();
  for (const day of days) {
    const ids = day.filter((id) => byId.has(id));
    if (ids.length < 2) continue;
    try {
      const matrix = await getCachedTravelMatrix(
        ids.map((id) => ({ lat: byId.get(id)!.lat!, lng: byId.get(id)!.lng! })),
        prisma,
        service,
      );
      ids.forEach((from, i) =>
        ids.forEach((to, j) => {
          const sec = matrix.durations[i]?.[j];
          if (i !== j && sec != null && Number.isFinite(sec) && sec > 0) minutes[`${from}|${to}`] = Math.round(sec / 60);
        }),
      );
    } catch (err) {
      console.error("getDayDriveMinutes:", err);
    }
  }
  return minutes;
}

// ─── Classes from YMU-A (#53) ────────────────────────────────────────────────

/**
 * Bring SVP's classes up to date from YMU-A. Called quietly when the planner
 * or dashboard opens (throttled to once every 5 minutes across everyone) and
 * by the "Refresh classes" button with force.
 */
export async function refreshClasses(force = false) {
  const session = await auth();
  requireUser(session);
  try {
    return { ok: true as const, result: await pullClassesFromYmua(prisma, { force }) };
  } catch (err) {
    console.error("refreshClasses:", err);
    return { ok: false as const, error: err instanceof Error ? err.message : "Couldn't reach YMU-A." };
  }
}
