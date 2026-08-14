"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireUser, schoolRegionWhere } from "@/lib/auth-helpers";
import { VisitInfo } from "@/lib/types";
import { format, addDays, startOfWeek } from "date-fns";
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

  const totalSchools = await prisma.school.count({ where: { ...regionWhere, active: true } });

  const visitCounts = await prisma.visit.groupBy({
    by: ["schoolId"],
    where: { status: "DONE", school: { ...regionWhere, active: true } },
    _count: { id: true },
  });

  const schools = await prisma.school.findMany({
    where: { ...regionWhere, active: true },
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
    where: { ...regionWhere, active: true },
    orderBy: { name: "asc" },
  });
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

  const date = new Date(weekStartDateIso);
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });

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
  const date = new Date(weekStartDateIso);
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const weekEnd = addDays(start, 5);
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
      date: format(s.startDateTime, "yyyy-MM-dd"),
      rule: {
        start: format(s.startDateTime, "HH:mm"),
        end: format(s.endDateTime, "HH:mm"),
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
  const date = new Date(weekStartDateIso);
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const weekEnd = addDays(start, 5);

  const sessions = await prisma.classSession.findMany({
    where: { schoolId, startDateTime: { gte: start }, endDateTime: { lt: weekEnd } },
    include: { subject: true },
    orderBy: { startDateTime: "asc" },
  });

  const isAfterschool = (name: string) => /afterschool/i.test(name ?? "");
  return sessions
    .filter((s) => !isAfterschool(s.subject?.name ?? ""))
    .map((s) => ({
      date: format(s.startDateTime, "yyyy-MM-dd"),
      rule: {
        start: format(s.startDateTime, "HH:mm"),
        end: format(s.endDateTime, "HH:mm"),
        class: s.subject.name,
      },
    }));
}


const originCoordsSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().optional(),
});

const observationRatingSchema = z.enum(["NEEDS_SUPPORT", "DEVELOPING", "MEETS", "EXCEEDS"]);

const confirmVisitSchema = z
  .object({
    // Only used for the first visit of the day (client asks the RM where
    // they're starting from). Every subsequent visit that day is chained
    // server-side from the previous confirmed visit and this is ignored.
    // In person is the default; online and phone visits skip the drive and
    // the classroom observation entirely.
    mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]).default("IN_PERSON"),
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
  })
  .refine((data) => !data.hasInstrumentRequest || !!data.instrumentRequestDetails?.trim(), {
    message: "instrumentRequestDetails is required when hasInstrumentRequest is true",
    path: ["instrumentRequestDetails"],
  });

function dayRangeFor(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
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
    orderBy: { createdAt: "desc" },
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
  clientOrigin?: { lat: number; lng: number; label?: string }
): Promise<{ lat: number; lng: number; label: string } | null> {
  const chained = await findPreviousVisitToday(visitedById, dayStart, dayEnd);
  if (chained) return chained;

  if (clientOrigin) {
    return { lat: clientOrigin.lat, lng: clientOrigin.lng, label: clientOrigin.label ?? "Custom address" };
  }

  const homeUser = await prisma.user.findUnique({
    where: { id: visitedById },
    select: { homeLat: true, homeLng: true },
  });
  if (homeUser?.homeLat != null && homeUser?.homeLng != null) {
    return { lat: homeUser.homeLat, lng: homeUser.homeLng, label: "Home" };
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

  const date = new Date(dateIso);
  const plannedStart = new Date(date);
  plannedStart.setHours(9, 0, 0, 0);
  const plannedEnd = new Date(date);
  plannedEnd.setHours(10, 0, 0, 0);
  const { dayStart, dayEnd } = dayRangeFor(date);

  // Mileage is auto-derived from the RM's own route order that day (previous
  // confirmed visit → this school). For the first visit of the day, the
  // client already asked where they're starting from (data.origin); that's
  // only used when there's no previous visit to chain from. Best-effort: if
  // no origin is available at all, the visit still confirms with
  // milesDriven unset.
  let milesDriven: number | null = null;
  let originLabel: string | null = null;

  // A remote visit has no leg to measure. Leaving milesDriven null (rather than
  // zero) is what keeps it out of the mileage report entirely.
  const isRemote = data.mode !== "IN_PERSON";

  if (!isRemote && school.lat != null && school.lng != null) {
    try {
      const origin = await resolveVisitOrigin(user.id, dayStart, dayEnd, data.origin);
      if (origin) {
        originLabel = origin.label;
        const matrix = await getCachedTravelMatrix(
          [{ lat: origin.lat, lng: origin.lng }, { lat: school.lat, lng: school.lng }],
          prisma,
          new OpenRouteDistanceService()
        );
        const distanceM = matrix.distances[0]?.[1];
        if (distanceM != null && Number.isFinite(distanceM)) {
          milesDriven = distanceM / 1609.344;
        }
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
        milesDriven: milesDriven ?? undefined,
        originLabel: originLabel ?? undefined,
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

  const effectiveRegionId =
    user.role === "ADMIN" && regionFilter
      ? regionFilter
      : baseWhere.regionId !== undefined
      ? baseWhere.regionId
      : undefined;

  const visits = await prisma.visit.findMany({
    where: {
      status: "DONE",
      ...(effectiveRegionId !== undefined
        ? { school: { regionId: effectiveRegionId } }
        : {}),
    },
    include: { school: true },
    orderBy: { plannedStartDateTime: "desc" },
  });

  // Normalize to the shape VisitHistory.tsx expects
  return visits.map((v) => ({
    id: v.id,
    schoolId: v.schoolId,
    date: v.plannedStartDateTime,
    notes: v.reason,
    school: v.school,
  }));
}

export async function addManualVisit(schoolId: string, dateIso: string, notes: string) {
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
      status: "DONE",
      reason: notes,
    },
  });
  return serializeVisit(visit);
}

export async function deleteVisitLog(id: string) {
  const visit = await prisma.visit.delete({ where: { id } });
  return serializeVisit(visit);
}

export async function editVisitLog(id: string, newDateIso: string, newNotes: string) {
  const date = new Date(newDateIso);
  const plannedStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0)
  );
  const plannedEnd = new Date(plannedStart.getTime() + 60 * 60 * 1000);
  const visit = await prisma.visit.update({
    where: { id },
    data: {
      plannedStartDateTime: plannedStart,
      plannedEndDateTime: plannedEnd,
      reason: newNotes,
    },
  });
  return serializeVisit(visit);
}

export async function getSchoolTeachers(schoolId: string) {
  return await prisma.teacher.findMany({
    where: { school: { id: schoolId } },
    orderBy: { createdAt: "desc" },
  });
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
