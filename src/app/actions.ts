"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser, schoolRegionWhere, scopeToRegion } from "@/lib/auth-helpers";
import { VisitInfo } from "@/lib/types";
import { format, addDays } from "date-fns";
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
import { haversineMeters } from "@/lib/geo";
import {
  APP_TIME_ZONE,
  dayKeyInAppZone,
  formatTimeInAppZone,
  addDaysToDayKey,
  mondayOfDayKey,
  toAppZoneDayKey,
  zonedDayStart,
} from "@/lib/timezone";
import { getMileageReportData } from "@/lib/reports/mileageReport";
import { resolveRange, type RangePreset } from "@/lib/reports/reportRange";
import { z } from "zod";

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
    user.role === "ADMIN" && regionFilter
      ? { regionId: regionFilter }
      : baseWhere;

  // The office is a stop, not a school to be visited on a schedule — counting it
  // here would inflate coverage against a target it was never part of.
  const schoolsOnly = { ...regionWhere, active: true, isOffice: false };

  const totalSchools = await prisma.school.count({ where: schoolsOnly });

  const visitCounts = await prisma.visit.groupBy({
    by: ["schoolId"],
    where: { status: "DONE", school: schoolsOnly },
    _count: { id: true },
  });

  const schools = await prisma.school.findMany({
    where: schoolsOnly,
    select: { id: true, name: true },
  });

  const visitedSchoolsList = schools
    .map((school) => {
      const vc = visitCounts.find((v) => v.schoolId === school.id);
      return { id: school.id, name: school.name, visitCount: vc ? vc._count.id : 0 };
    })
    .sort((a, b) => b.visitCount - a.visitCount);

  return {
    totalActiveSchools: totalSchools,
    dueThisWeek: Math.floor(totalSchools / 3),
    overdue: 0,
    recentCancellations: 0,
    visitedSchoolsList,
  };
}

export async function getSchools(regionFilter?: string | null) {
  const session = await auth();
  const user = requireUser(session);
  const baseWhere = schoolRegionWhere(user);
  const regionWhere =
    user.role === "ADMIN" && regionFilter
      ? { regionId: regionFilter }
      : baseWhere;

  return await prisma.school.findMany({
    where: { ...regionWhere, active: true, isOffice: false },
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
    user.role === "ADMIN" && regionFilter
      ? regionFilter
      : user.regionId ?? undefined;

  // Accepts either a "yyyy-MM-dd" week key or, from an older client, a full
  // ISO instant — both resolved to a Miami calendar day before picking the week,
  // so the host's zone never decides which Monday was meant.
  const weekStart = zonedDayStart(mondayOfDayKey(toAppZoneDayKey(weekStartDateIso)));

  const distanceService =
    process.env.OPENROUTE_SERVICE_API_KEY ? new OpenRouteDistanceService() : undefined;

  const proposed = await proposeVisitsForWeek(prisma, weekStart, {
    regionId,
    maxVisitsPerWeek,
    maxVisitsPerDay,
    distanceService,
  });

  let plan: VisitInfo[] = proposed.map(proposedVisitToVisitInfo);

  // Apply skips from DB and manual overrides
  const skippedInDb = await prisma.visit.findMany({
    where: {
      status: "SKIPPED",
      plannedStartDateTime: { gte: weekStart, lt: addDays(weekStart, 5) },
    },
    select: { schoolId: true, plannedStartDateTime: true },
  });
  const skipSet = new Set(
    skippedInDb.map((s) => `${s.schoolId}:${format(s.plannedStartDateTime, "yyyy-MM-dd")}`)
  );
  for (const o of manualOverrides) {
    if (o.isSkipped && o.schoolId && o.date) {
      skipSet.add(`${o.schoolId}:${format(new Date(o.date), "yyyy-MM-dd")}`);
    }
  }
  plan = plan.filter((v) => !skipSet.has(`${v.schoolId}:${format(v.date, "yyyy-MM-dd")}`));

  // Apply pinned overrides
  for (const o of manualOverrides) {
    if (o.isPinned && o.schoolId && o.date) {
      const key = `${o.schoolId}:${format(new Date(o.date), "yyyy-MM-dd")}`;
      if (plan.some((v) => `${v.schoolId}:${format(v.date, "yyyy-MM-dd")}` === key)) continue;
      const school = await prisma.school.findUnique({ where: { id: o.schoolId } });
      if (school) {
        plan = plan.filter((v) => v.schoolId !== o.schoolId || v.isCompleted);
        plan.push({
          schoolId: school.id,
          schoolName: school.name,
          zipCode: school.zipCode,
          date: new Date(o.date),
          score: 1000,
          reason: "Pinned manually",
          startTime: o.startTime ?? "09:00",
          endTime: o.endTime ?? "10:00",
          isPinned: true,
          isCompleted: false,
          viableOptionsThisWeek: [],
        });
      }
    }
  }

  // Overlay completed visits from DB
  const visitsDoneWeek = await prisma.visit.findMany({
    where: {
      status: "DONE",
      plannedStartDateTime: { gte: weekStart, lt: addDays(weekStart, 5) },
      ...(regionId ? { school: { regionId } } : {}),
    },
    include: { school: true },
  });
  for (const v of visitsDoneWeek) {
    const d = v.plannedStartDateTime;
    const idx = plan.findIndex(
      (p) =>
        p.schoolId === v.schoolId &&
        format(p.date, "yyyy-MM-dd") === format(d, "yyyy-MM-dd")
    );
    const completed: VisitInfo = {
      schoolId: v.schoolId,
      schoolName: v.school.name,
      zipCode: v.school.zipCode,
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

export async function getSchoolOptionsForWeek(
  schoolId: string,
  weekStartDateIso: string
): Promise<import("@/lib/types").ViableOption[]> {
  // Same Miami-anchored week as getWeeklyPlan, so the two can't disagree about
  // which days the week covers.
  const weekKey = mondayOfDayKey(toAppZoneDayKey(weekStartDateIso));
  const start = zonedDayStart(weekKey);
  const weekEnd = zonedDayStart(addDaysToDayKey(weekKey, 5));
  const weekDates = Array.from({ length: 5 }, (_, i) => addDays(start, i));

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  if (!school) return [];

  type ViableOption = import("@/lib/types").ViableOption;
  const seen = new Set<string>();
  const merged: ViableOption[] = [];
  const addOption = (opt: ViableOption) => {
    const key = `${opt.date}-${opt.rule.start}-${opt.rule.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(opt);
  };

  const sessions = await prisma.classSession.findMany({
    where: { schoolId, startDateTime: { gte: start }, endDateTime: { lt: weekEnd } },
    include: { subject: true },
  });
  const isAfterschool = (name: string) => /afterschool/i.test(name ?? "");
  for (const s of sessions) {
    if (isAfterschool(s.subject?.name ?? "")) continue;
    addOption({
      date: dayKeyInAppZone(s.startDateTime),
      rule: {
        start: formatTimeInAppZone(s.startDateTime),
        end: formatTimeInAppZone(s.endDateTime),
        class: s.subject.name,
      },
    });
  }

  let rules: any[] = [];
  try { rules = JSON.parse(school.availability); } catch { return merged; }
  if (!Array.isArray(rules) || rules.length === 0) return merged;

  for (const d of weekDates) {
    const weekdayName = format(d, "EEEE");
    for (const r of rules) {
      if (/afterschool/i.test(r?.class ?? "")) continue;
      if (r.weekday && r.weekday !== weekdayName) continue;
      if (!r.weekday) continue;
      addOption({ date: format(d, "yyyy-MM-dd"), rule: r });
    }
  }

  return merged;
}

export async function getSchoolCalendarOptionsForWeek(
  schoolId: string,
  weekStartDateIso: string
): Promise<import("@/lib/types").ViableOption[]> {
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

  const isAfterschool = (name: string) => /afterschool/i.test(name ?? "");
  return sessions
    .filter((s) => !isAfterschool(s.subject?.name ?? ""))
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

const confirmVisitSchema = z
  .object({
    // Only used for the first visit of the day (client asks the RM where
    // they're starting from). Every subsequent visit that day is chained
    // server-side from the previous confirmed visit and this is ignored.
    // In person is the default; online and phone visits skip the drive and
    // the classroom observation entirely.
    mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]).default("IN_PERSON"),
    // Van miles are measured but never reimbursed; see the mileage report.
    vehicle: z.enum(["PERSONAL", "YMU_VAN"]).default("PERSONAL"),
    // Who the ratings are about. Taken from the class slot the visit was booked
    // against, so it needs no asking in the planner's flow.
    observedTeacherId: z.string().optional(),
    origin: originCoordsSchema.optional(),
    visitedWith: z.array(z.enum(["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER", "YMU_TEACHER"])).default([]),
    principalNotes: z.string().max(2000).optional(),
    hasInstrumentRequest: z.boolean().default(false),
    instrumentRequestDetails: z.string().max(2000).optional(),
    geofenceDistanceM: z.number().optional(),
    geofenceOverridden: z.boolean().default(false),
    // Teacher observation — shown when visitedWith includes YMU_TEACHER.
    // Each domain is independently skippable.
    obsPlanningPrep: observationRatingSchema.optional(),
    obsCultureManagement: observationRatingSchema.optional(),
    obsInstructionMusicianship: observationRatingSchema.optional(),
    obsEngagementEvidence: observationRatingSchema.optional(),
    obsProfessionalismGrowth: observationRatingSchema.optional(),
    obsNotes: z.string().max(2000).optional(),
    // Set instead of ratings when there was no lesson to watch.
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
 * Whether confirming a visit on `dateIso` would be the RM's first of the
 * day (in which case the UI should ask where they're starting from) or a
 * later one (mileage auto-chains from the previous confirmed visit, no
 * question needed). Returns the previous stop's name when chaining applies.
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

export async function confirmVisit(schoolId: string, dateIso: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);

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
        // Never on a remote visit: there is no class in the room to rate.
        observedTeacherId: isRemote ? undefined : data.observedTeacherId,
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
        obsPlanningPrep: isRemote ? undefined : data.obsPlanningPrep,
        obsCultureManagement: isRemote ? undefined : data.obsCultureManagement,
        obsInstructionMusicianship: isRemote ? undefined : data.obsInstructionMusicianship,
        obsEngagementEvidence: isRemote ? undefined : data.obsEngagementEvidence,
        obsProfessionalismGrowth: isRemote ? undefined : data.obsProfessionalismGrowth,
        obsNotes: isRemote ? undefined : data.obsNotes ?? undefined,
        obsSkipReason: isRemote ? undefined : data.obsSkipReason,
        obsSkipNotes: isRemote ? undefined : data.obsSkipNotes ?? undefined,
      },
    });
  });

  // Server actions can only return plain-serializable values to Client
  // Components — Prisma's Decimal type isn't, so convert it here.
  return { id: visit.id, milesDriven: decimalToNumber(visit.milesDriven) };
}

export async function skipVisit(schoolId: string, dateIso: string) {
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
  const isAdminFilter = user.role === "ADMIN" && !!regionFilter;
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
      observedTeacher: { select: { name: true } },
    },
    orderBy: { plannedStartDateTime: "desc" },
  });

  // Normalize to the shape VisitHistory.tsx expects
  return visits.map((v) => ({
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
    observations: {
      obsPlanningPrep: v.obsPlanningPrep,
      obsCultureManagement: v.obsCultureManagement,
      obsInstructionMusicianship: v.obsInstructionMusicianship,
      obsEngagementEvidence: v.obsEngagementEvidence,
      obsProfessionalismGrowth: v.obsProfessionalismGrowth,
    },
    obsNotes: v.obsNotes,
    obsSkipReason: v.obsSkipReason,
    obsSkipNotes: v.obsSkipNotes,
    observedTeacherId: v.observedTeacherId,
    observedTeacherName: v.observedTeacher?.name ?? null,
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
 * sends, minus the geofence — a visit typed in after the fact can't prove where
 * the RM was standing, so it carries no location check.
 */
const manualVisitSchema = z.object({
  mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]).default("IN_PERSON"),
  vehicle: z.enum(["PERSONAL", "YMU_VAN"]).default("PERSONAL"),
  observedTeacherId: z.string().optional(),
  origin: originCoordsSchema.optional(),
  notes: z.string().max(2000).optional(),
  visitedWith: z.array(z.enum(["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER", "YMU_TEACHER"])).default([]),
  principalNotes: z.string().max(2000).optional(),
  hasInstrumentRequest: z.boolean().default(false),
  instrumentRequestDetails: z.string().max(2000).optional(),
  obsPlanningPrep: observationRatingSchema.optional(),
  obsCultureManagement: observationRatingSchema.optional(),
  obsInstructionMusicianship: observationRatingSchema.optional(),
  obsEngagementEvidence: observationRatingSchema.optional(),
  obsProfessionalismGrowth: observationRatingSchema.optional(),
  obsNotes: z.string().max(2000).optional(),
  obsSkipReason: observationSkipReasonSchema.optional(),
  obsSkipNotes: z.string().max(2000).optional(),
});

export async function addManualVisit(schoolId: string, dateIso: string, formData: unknown) {
  const session = await auth();
  const user = requireUser(session);

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

  const skippedObs = data.obsSkipReason != null;

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
      observedTeacherId: isRemote ? undefined : data.observedTeacherId,
      milesDriven: milesDriven ?? undefined,
      commuteMiles: commuteMiles ?? undefined,
      originLabel: originLabel ?? undefined,
      originLat: originLat ?? undefined,
      originLng: originLng ?? undefined,
      visitedWith: data.visitedWith,
      principalNotes: data.principalNotes ?? undefined,
      hasInstrumentRequest: data.hasInstrumentRequest,
      instrumentRequestDetails: data.instrumentRequestDetails ?? undefined,
      // A remote visit has no classroom, and a skipped observation carries a
      // reason instead of ratings — never both.
      obsPlanningPrep: isRemote || skippedObs ? undefined : data.obsPlanningPrep,
      obsCultureManagement: isRemote || skippedObs ? undefined : data.obsCultureManagement,
      obsInstructionMusicianship: isRemote || skippedObs ? undefined : data.obsInstructionMusicianship,
      obsEngagementEvidence: isRemote || skippedObs ? undefined : data.obsEngagementEvidence,
      obsProfessionalismGrowth: isRemote || skippedObs ? undefined : data.obsProfessionalismGrowth,
      obsNotes: isRemote || skippedObs ? undefined : data.obsNotes ?? undefined,
      obsSkipReason: isRemote ? undefined : data.obsSkipReason,
      obsSkipNotes: isRemote ? undefined : data.obsSkipNotes ?? undefined,
    },
  });
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
  };
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
  const dayOrigin = existing.find((v) => v.originLat != null && v.originLng != null);
  const startPoint =
    dayOrigin?.originLat != null && dayOrigin.originLng != null
      ? { lat: dayOrigin.originLat, lng: dayOrigin.originLng, label: dayOrigin.originLabel ?? "Start" }
      : null;
  const startIsCommute = (dayOrigin?.commuteMiles ?? null) != null;

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
  const visit = await prisma.visit.delete({ where: { id } });
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
  vehicle: z.enum(["PERSONAL", "YMU_VAN"]).optional(),
  observedTeacherId: z.string().nullable().optional(),
  visitedWith: z.array(z.enum(["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER", "YMU_TEACHER"])).optional(),
  principalNotes: z.string().max(2000).optional(),
  hasInstrumentRequest: z.boolean().optional(),
  instrumentRequestDetails: z.string().max(2000).optional(),
  obsPlanningPrep: observationRatingSchema.nullable().optional(),
  obsCultureManagement: observationRatingSchema.nullable().optional(),
  obsInstructionMusicianship: observationRatingSchema.nullable().optional(),
  obsEngagementEvidence: observationRatingSchema.nullable().optional(),
  obsProfessionalismGrowth: observationRatingSchema.nullable().optional(),
  obsNotes: z.string().max(2000).optional(),
  obsSkipReason: observationSkipReasonSchema.nullable().optional(),
  obsSkipNotes: z.string().max(2000).optional(),
});

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

  const existing = await prisma.visit.findUnique({ where: { id }, select: { visitedById: true, plannedStartDateTime: true } });
  if (!existing) throw new Error("Visit not found");
  if (existing.visitedById && existing.visitedById !== user.id && user.role !== "ADMIN") {
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

  const visit = await prisma.visit.update({
    where: { id },
    data: {
      plannedStartDateTime: plannedStart,
      ...(plannedEnd ? { plannedEndDateTime: plannedEnd } : {}),
      ...(data.notes !== undefined ? { reason: data.notes || "Manual logging" } : {}),
      ...(data.vehicle !== undefined ? { vehicle: data.vehicle } : {}),
      ...(data.observedTeacherId !== undefined ? { observedTeacherId: data.observedTeacherId } : {}),
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
      // Ratings and a skip reason are mutually exclusive, so setting one clears
      // the other — otherwise correcting a mislabelled visit would leave stale
      // ratings sitting behind the reason.
      ...(data.obsSkipReason !== undefined
        ? {
            obsSkipReason: data.obsSkipReason,
            obsSkipNotes: skipped ? data.obsSkipNotes || null : null,
            ...(skipped
              ? {
                  obsPlanningPrep: null,
                  obsCultureManagement: null,
                  obsInstructionMusicianship: null,
                  obsEngagementEvidence: null,
                  obsProfessionalismGrowth: null,
                  obsNotes: null,
                }
              : {}),
          }
        : {}),
      ...(!skipped && data.obsPlanningPrep !== undefined ? { obsPlanningPrep: data.obsPlanningPrep } : {}),
      ...(!skipped && data.obsCultureManagement !== undefined ? { obsCultureManagement: data.obsCultureManagement } : {}),
      ...(!skipped && data.obsInstructionMusicianship !== undefined ? { obsInstructionMusicianship: data.obsInstructionMusicianship } : {}),
      ...(!skipped && data.obsEngagementEvidence !== undefined ? { obsEngagementEvidence: data.obsEngagementEvidence } : {}),
      ...(!skipped && data.obsProfessionalismGrowth !== undefined ? { obsProfessionalismGrowth: data.obsProfessionalismGrowth } : {}),
      ...(!skipped && data.obsNotes !== undefined ? { obsNotes: data.obsNotes || null } : {}),
    },
  });
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

  const [schedules, teachers, visits] = await Promise.all([
    getSchoolWeeklySchedules([schoolId]),
    getSchoolTeachers(schoolId),
    prisma.visit.findMany({
      where: { schoolId, status: "DONE" },
      include: { visitedBy: { select: { name: true, email: true } } },
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
      observations: {
        obsPlanningPrep: v.obsPlanningPrep,
        obsCultureManagement: v.obsCultureManagement,
        obsInstructionMusicianship: v.obsInstructionMusicianship,
        obsEngagementEvidence: v.obsEngagementEvidence,
        obsProfessionalismGrowth: v.obsProfessionalismGrowth,
      },
      obsNotes: v.obsNotes,
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

  // A visit now names the teacher it observed, so that is used where it exists.
  // Older visits recorded only the school; those are still shown, marked as
  // unattributed, because dropping them would lose the history they hold — but
  // they are the reason a school with two teachers shows the same visit twice.
  const visits = schoolIds.length
    ? await prisma.visit.findMany({
        where: {
          status: "DONE",
          OR: [
            { observedTeacherId: teacherId },
            {
              observedTeacherId: null,
              schoolId: { in: schoolIds },
              visitedWith: { has: "YMU_TEACHER" },
            },
          ],
        },
        include: {
          school: { select: { id: true, name: true } },
          visitedBy: { select: { name: true, email: true } },
        },
        orderBy: { plannedStartDateTime: "desc" },
      })
    : [];

  const observations = visits.map((v) => ({
    id: v.id,
    date: v.plannedStartDateTime,
    schoolId: v.school.id,
    schoolName: v.school.name,
    visitedByName: v.visitedBy?.name ?? v.visitedBy?.email ?? null,
    isMine: v.visitedById === user.id,
    mode: v.mode,
    // False for older visits that recorded only the school.
    attributed: v.observedTeacherId === teacherId,
    ratings: {
      obsPlanningPrep: v.obsPlanningPrep,
      obsCultureManagement: v.obsCultureManagement,
      obsInstructionMusicianship: v.obsInstructionMusicianship,
      obsEngagementEvidence: v.obsEngagementEvidence,
      obsProfessionalismGrowth: v.obsProfessionalismGrowth,
    },
    obsNotes: v.obsNotes,
    obsSkipReason: v.obsSkipReason,
    obsSkipNotes: v.obsSkipNotes,
    principalNotes: v.principalNotes,
  }));

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

export async function createTeacher(schoolId: string, data: { name: string; subjects?: string }) {
  return await prisma.teacher.create({
    data: {
      school: { connect: { id: schoolId } },
      name: data.name,
      subjects: data.subjects ?? null,
    },
  });
}

export async function updateTeacher(teacherId: string, data: { name?: string; subjects?: string }) {
  return await prisma.teacher.update({
    where: { id: teacherId },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.subjects != null ? { subjects: data.subjects } : {}),
    },
  });
}

export async function deleteTeacher(teacherId: string) {
  return await prisma.teacher.delete({ where: { id: teacherId } });
}

// ─── VisitRule actions ─────────────────────────────────────────────────────────

const visitRuleSchema = z.object({
  frequencyType: z.enum(["WEEKLY", "BIWEEKLY", "EVERY_3_WEEKS", "MONTHLY"]),
  reason: z.string().max(500).optional(),
  effectiveFrom: z.string().optional(), // ISO date string
});

export async function getVisitRulesForSchool(schoolId: string) {
  return await prisma.visitRule.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createVisitRule(schoolId: string, formData: unknown) {
  const session = await auth();
  requireUser(session);

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
  requireUser(session);
  return await prisma.visitRule.update({
    where: { id: ruleId },
    data: { effectiveTo: new Date() },
  });
}

export async function updateVisitRule(ruleId: string, formData: unknown) {
  const session = await auth();
  requireUser(session);

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
  options?: { manualOrder?: string[]; departureTime?: string; reoptimize?: boolean }
) {
  const session = await auth();
  const user = requireUser(session);

  if (!process.env.OPENROUTE_SERVICE_API_KEY) {
    throw new Error("OPENROUTE_SERVICE_API_KEY is not configured");
  }

  if (schoolIds.length === 0) {
    throw new Error("Select at least one school to visit");
  }

  const baseWhere = schoolRegionWhere(user);
  const schools = await prisma.school.findMany({
    where: { id: { in: schoolIds }, ...baseWhere, active: true },
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
    route = await optimizeRoute(prisma, start, stopInputs, departureTime);
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

  if (user.role !== "ADMIN" && user.role !== "REGIONAL_MANAGER") {
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true },
    });
    return me ? [me] : [];
  }

  return await prisma.user.findMany({
    where: user.role === "ADMIN" ? {} : { regionId: user.regionId ?? undefined },
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

  const regionId = user.role === "ADMIN" ? params.regionId ?? undefined : scopeToRegion(user);
  const canSeeOthers = user.role === "ADMIN" || user.role === "REGIONAL_MANAGER";
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
