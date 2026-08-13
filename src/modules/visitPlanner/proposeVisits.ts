/**
 * proposeVisitsForWeek — the single visit planner for YMU (Phase 2+).
 *
 * CONTRACT:
 *   Input:  prisma, weekStart (any date in the target week), options.regionId
 *   Output: ProposedVisit[] — at most one entry per school, covering Mon–Fri
 *
 *   ELIGIBILITY (hard rule):
 *     A school is eligible if it belongs to the RM's region AND has not been
 *     visited within its frequency window (default: BIWEEKLY = 14 days).
 *     ClassSession existence is NOT required for eligibility.
 *
 *   SCORING (soft, affects day selection):
 *     base = days overdue * 5 + 100  (or days-since-last if not yet due)
 *     class bonus = +20 when a ClassSession exists on that day
 *     Schools with no class on the selected day carry noClassWarning=true
 *     and are labelled "No class — admin/catch-up visit".
 *
 *   PACKING:
 *     Greedy day-by-day: for each Mon→Fri, pick highest-scoring unscheduled
 *     schools up to maxVisitsPerDay, stopping when maxVisitsPerWeek is hit.
 *     Selected visits are ordered chronologically by class time by default.
 *     If distanceService is provided and all candidates have coords, the
 *     daily order is instead chosen to respect each fixed ClassSession time
 *     window while minimizing travel (see orderByFeasibleSchedule) — not
 *     just nearest-neighbor distance. Visits that can't be reached on time
 *     in any ordering are flagged with scheduleConflict=true.
 */

import { PrismaClient } from "@prisma/client";
import type { FrequencyType } from "@prisma/client";
import { addDays, format, startOfWeek } from "date-fns";
import type { LatLng } from "./distance/types";
import { getCachedTravelMatrix } from "@/lib/routing/cachedDistanceMatrix";
import { haversineMeters } from "@/lib/geo";
import type { ProposedVisit, ProposeVisitsOptions, WorkWindow } from "./types";
import { getDefaultWorkWindow, getFrequencyDays } from "./types";

// TODO Phase 3: make configurable per RM in settings
const DEFAULT_MAX_VISITS_PER_DAY = 4;
const DEFAULT_MAX_VISITS_PER_WEEK = 12;

const CLASS_SCORE_BONUS = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function getWeekNumber(date: Date): number {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  return Math.floor(weekStart.getTime() / MS_PER_WEEK);
}

function shouldProposeThisWeek(freq: FrequencyType, lastVisitWeek: number, currentWeek: number): boolean {
  const weeksSinceLast = currentWeek - lastVisitWeek;
  switch (freq) {
    case "WEEKLY": return weeksSinceLast >= 1;
    case "BIWEEKLY": return weeksSinceLast >= 2;
    case "EVERY_3_WEEKS": return weeksSinceLast >= 3;
    case "MONTHLY": return weeksSinceLast >= 4;
    default: return true;
  }
}

function isInWorkWindow(startMins: number, endMins: number, window: WorkWindow): boolean {
  const wStart = timeToMins(window.start);
  const wEnd = timeToMins(window.end);
  return startMins >= wStart && endMins <= wEnd;
}

function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

const isAfterschool = (name: string) => /afterschool/i.test(name ?? "");

export async function proposeVisitsForWeek(
  prisma: PrismaClient,
  weekStart: Date,
  options?: ProposeVisitsOptions
): Promise<ProposedVisit[]> {
  const workWindow = options?.workWindow ?? getDefaultWorkWindow();
  const maxVisitsPerWeek = options?.maxVisitsPerWeek ?? DEFAULT_MAX_VISITS_PER_WEEK;
  const maxVisitsPerDay = options?.maxVisitsPerDay ?? DEFAULT_MAX_VISITS_PER_DAY;
  const distanceService = options?.distanceService;
  const regionId = options?.regionId;

  const weekStartNorm = startOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 5 }, (_, i) => addDays(weekStartNorm, i));
  const weekEnd = addDays(weekStartNorm, 5);
  const currentWeek = getWeekNumber(weekStartNorm);

  // Fetch all data in parallel
  const schoolWhere = regionId
    ? { active: true, regionId }
    : { active: true };

  const [schools, visitRules, doneVisits, classSessionsInWeek] = await Promise.all([
    prisma.school.findMany({
      where: schoolWhere,
      select: { id: true, name: true, zipCode: true, lat: true, lng: true },
    }),
    prisma.visitRule.findMany({
      where: { school: schoolWhere },
      orderBy: { createdAt: "desc" }, // latest rule first
    }),
    prisma.visit.findMany({
      where: { status: "DONE", school: schoolWhere },
      orderBy: { plannedStartDateTime: "desc" },
      select: { schoolId: true, plannedStartDateTime: true },
    }),
    prisma.classSession.findMany({
      where: {
        startDateTime: { gte: weekStartNorm },
        endDateTime: { lt: weekEnd },
        school: schoolWhere,
      },
      include: { subject: true },
    }),
  ]);

  if (schools.length === 0) return [];

  // Last visit per school (most recent DONE)
  const lastVisitBySchool = new Map<string, Date>();
  for (const v of doneVisits) {
    if (!lastVisitBySchool.has(v.schoolId)) {
      lastVisitBySchool.set(v.schoolId, v.plannedStartDateTime);
    }
  }

  // Active VisitRule per school (latest rule where effectiveTo is null = still active)
  const activeRuleBySchool = new Map<string, typeof visitRules[number]>();
  for (const rule of visitRules) {
    if (activeRuleBySchool.has(rule.schoolId)) continue; // already have latest
    if (rule.effectiveTo === null || rule.effectiveTo === undefined) {
      activeRuleBySchool.set(rule.schoolId, rule);
    }
  }

  // Class sessions indexed by schoolId+dayStr for O(1) lookup
  const sessionsBySchoolDay = new Map<string, typeof classSessionsInWeek[number][]>();
  for (const s of classSessionsInWeek) {
    if (isAfterschool(s.subject?.name ?? "")) continue;
    const key = `${s.schoolId}:${format(s.startDateTime, "yyyy-MM-dd")}`;
    if (!sessionsBySchoolDay.has(key)) sessionsBySchoolDay.set(key, []);
    sessionsBySchoolDay.get(key)!.push(s);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  type Candidate = {
    schoolId: string;
    schoolName: string;
    /** yyyy-MM-dd of the weekday this candidate is for. */
    dayStr: string;
    zipCode: string;
    lat: number | null;
    lng: number | null;
    date: Date;
    startTime: string;
    endTime: string;
    score: number;
    reason: string;
    subjectName?: string;
    noClassWarning: boolean;
    visitRuleFrequency: string;
    visitRuleNote?: string;
    scheduleConflict?: boolean;
  };

  // Build candidate list: one entry per (eligible school × weekday)
  const candidatesByDay = new Map<string, Candidate[]>();

  for (const school of schools) {
    const rule = activeRuleBySchool.get(school.id);
    const freq: FrequencyType = rule?.frequencyType ?? "BIWEEKLY";
    const lastVisit = lastVisitBySchool.get(school.id);
    const lastVisitWeek = lastVisit ? getWeekNumber(lastVisit) : 0;

    if (!shouldProposeThisWeek(freq, lastVisitWeek, currentWeek)) continue;

    // Collected across the whole week so that, once we know whether this
    // school teaches at all this week, the days it doesn't can be dropped.
    const schoolCandidates: Candidate[] = [];

    const daysSinceLast = lastVisit
      ? Math.floor((today.getTime() - lastVisit.getTime()) / MS_PER_DAY)
      : 999;
    const freqDays = getFrequencyDays(freq);
    const isOverdue = daysSinceLast >= freqDays;
    const baseScore = isOverdue
      ? 100 + (daysSinceLast - freqDays) * 5
      : Math.max(1, daysSinceLast);
    const visitRuleFrequency = rule ? rule.frequencyType : "DEFAULT";
    const visitRuleNote = rule?.reason ?? undefined;

    for (const day of weekDates) {
      const dayStr = format(day, "yyyy-MM-dd");
      const key = `${school.id}:${dayStr}`;
      const sessions = sessionsBySchoolDay.get(key) ?? [];

      // Pick the best in-window session for this day (if any)
      const bestSession = sessions
        .filter((s) => {
          const startMins = s.startDateTime.getHours() * 60 + s.startDateTime.getMinutes();
          const endMins = s.endDateTime.getHours() * 60 + s.endDateTime.getMinutes();
          return isInWorkWindow(startMins, endMins, workWindow);
        })
        .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];

      const hasClass = bestSession !== undefined;
      const score = baseScore + (hasClass ? CLASS_SCORE_BONUS : 0);

      const reasonText = isOverdue
        ? `Overdue by ${daysSinceLast - freqDays} days`
        : daysSinceLast >= 90
          ? "Action Required (Never Visited)"
          : `Due in ${freqDays - daysSinceLast} days`;

      const candidate: Candidate = {
        schoolId: school.id,
        schoolName: school.name,
        dayStr,
        zipCode: school.zipCode,
        lat: school.lat ?? null,
        lng: school.lng ?? null,
        date: hasClass ? bestSession.startDateTime : new Date(`${dayStr}T09:00:00`),
        startTime: hasClass ? format(bestSession.startDateTime, "HH:mm") : "09:00",
        endTime: hasClass ? format(bestSession.endDateTime, "HH:mm") : "10:00",
        score,
        reason: reasonText,
        subjectName: bestSession?.subject?.name,
        noClassWarning: !hasClass,
        visitRuleFrequency,
        visitRuleNote,
      };

      schoolCandidates.push(candidate);
    }

    // A day the school does not teach is not a visit. There is no fallback to
    // an "admin / catch-up" slot: a school with nothing on its calendar this
    // week simply isn't proposed, rather than filling the plan with stops that
    // have nothing to observe.
    const usable = schoolCandidates.filter((c) => !c.noClassWarning);

    for (const candidate of usable) {
      if (!candidatesByDay.has(candidate.dayStr)) candidatesByDay.set(candidate.dayStr, []);
      candidatesByDay.get(candidate.dayStr)!.push(candidate);
    }
  }

  // Selection rule: schools that are close together AND teaching that day.
  //
  // Every candidate here already teaches on its day, so the remaining decision
  // is which of them to group. Each day is seeded with the school that is most
  // overdue, then grown by repeatedly adding whichever remaining school is
  // physically closest to the ones already picked — so a day is a tight
  // cluster of stops rather than a drive across the county.
  //
  // Distance here is straight-line, not road time: choosing the cluster needs
  // every pair of candidates compared, which would be hundreds of routing
  // calls per day. Road time still decides the order of the stops once the
  // cluster is fixed, below.
  const scheduledSchoolIds = new Set<string>();
  const chosenByDay = new Map<string, Candidate[]>();
  let weeklyCount = 0;

  const distanceToCluster = (candidate: Candidate, cluster: Candidate[]): number => {
    if (candidate.lat == null || candidate.lng == null) return Infinity;
    let nearest = Infinity;
    for (const member of cluster) {
      if (member.lat == null || member.lng == null) continue;
      nearest = Math.min(
        nearest,
        haversineMeters(candidate.lat, candidate.lng, member.lat, member.lng)
      );
    }
    return nearest;
  };

  for (const day of weekDates) {
    if (weeklyCount >= maxVisitsPerWeek) break;

    const dayStr = format(day, "yyyy-MM-dd");
    const pool = (candidatesByDay.get(dayStr) ?? [])
      .filter((c) => !scheduledSchoolIds.has(c.schoolId))
      .sort((a, b) => b.score - a.score);
    if (pool.length === 0) continue;

    const room = Math.min(maxVisitsPerDay, maxVisitsPerWeek - weeklyCount);
    const cluster: Candidate[] = [pool.shift()!];

    while (cluster.length < room && pool.length > 0) {
      // Falls back to index 0 — the most overdue — when no candidate has
      // usable coordinates, since every distance is then Infinity.
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < pool.length; i += 1) {
        const distance = distanceToCluster(pool[i], cluster);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
      cluster.push(pool.splice(bestIndex, 1)[0]);
    }

    for (const c of cluster) {
      scheduledSchoolIds.add(c.schoolId);
      weeklyCount += 1;
    }
    chosenByDay.set(dayStr, cluster);
  }

  // Then order each day's picks: chronological, refined by travel time.
  const proposed: ProposedVisit[] = [];

  for (const day of weekDates) {
    const dayStr = format(day, "yyyy-MM-dd");
    let selected = chosenByDay.get(dayStr) ?? [];
    if (selected.length === 0) continue;

    // Base order: chronological by class time — a saner default than score
    // order for a day's visit sequence, and the fallback when no distance
    // data is available.
    selected = selected.slice().sort((a, b) => timeToMins(a.startTime) - timeToMins(b.startTime));

    if (selected.length > 1 && distanceService) {
      const withCoords = selected.filter((s) => s.lat != null && s.lng != null);
      if (withCoords.length === selected.length) {
        try {
          const points: LatLng[] = selected.map((s) => ({ lat: s.lat!, lng: s.lng! }));
          const matrix = await getCachedTravelMatrix(points, prisma, distanceService);
          const { order, conflictSchoolIds } = orderByFeasibleSchedule(selected, matrix.durations);
          selected = order.map((c) =>
            conflictSchoolIds.has(c.schoolId) ? { ...c, scheduleConflict: true } : c
          );
        } catch {
          // keep chronological order on error
        }
      }
    }

    for (const c of selected) {
      scheduledSchoolIds.add(c.schoolId);
      weeklyCount += 1;
      proposed.push({
        schoolId: c.schoolId,
        schoolName: c.schoolName,
        zipCode: c.zipCode,
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
        date: c.date,
        startTime: c.startTime,
        endTime: c.endTime,
        score: c.score,
        reason: c.reason,
        subjectName: c.subjectName,
        noClassWarning: c.noClassWarning,
        visitRuleFrequency: c.visitRuleFrequency,
        visitRuleNote: c.visitRuleNote,
        scheduleConflict: c.scheduleConflict ?? false,
      });
    }
  }

  return proposed;
}

// A fixed-window visit (has a real ClassSession) must be reached within this
// many minutes of its class start time to count as "feasible" — small buffer
// for rounding/last-minute parking, etc.
const LATE_TOLERANCE_MIN = 5;
// Above this many same-day candidates, brute-force permutation search
// becomes too expensive (9! = 362,880+); fall back to the chronological
// baseline order instead. maxVisitsPerDay defaults to 4, so this path is
// rarely exercised.
const MAX_PERMUTATION_STOPS = 8;

type SchedulableCandidate = {
  schoolId: string;
  startTime: string;
  endTime: string;
  noClassWarning: boolean;
};

type OrderMetrics = {
  feasible: boolean;
  totalLatenessMin: number;
  totalTravelSec: number;
  lateIndices: Set<number>;
};

function evaluateOrder(order: number[], candidates: SchedulableCandidate[], durations: number[][]): OrderMetrics {
  let totalTravelSec = 0;
  let totalLatenessMin = 0;
  let feasible = true;
  const lateIndices = new Set<number>();
  let cursorMins = 0;
  let prevIdx: number | null = null;

  for (const idx of order) {
    const cand = candidates[idx];
    const isFixed = !cand.noClassWarning;
    const startMins = timeToMins(cand.startTime);
    const endMins = timeToMins(cand.endTime);

    if (prevIdx === null) {
      cursorMins = startMins;
    } else {
      const travelSec = durations[prevIdx]?.[idx] ?? 0;
      totalTravelSec += travelSec;
      const arrivalMins = cursorMins + travelSec / 60;
      if (isFixed && arrivalMins > startMins + LATE_TOLERANCE_MIN) {
        feasible = false;
        totalLatenessMin += arrivalMins - startMins;
        lateIndices.add(idx);
      }
      cursorMins = Math.max(arrivalMins, startMins);
    }
    cursorMins = Math.max(cursorMins, endMins);
    prevIdx = idx;
  }

  return { feasible, totalLatenessMin, totalTravelSec, lateIndices };
}

function permutations(indices: number[]): number[][] {
  if (indices.length <= 1) return [indices];
  const result: number[][] = [];
  for (let i = 0; i < indices.length; i++) {
    const rest = [...indices.slice(0, i), ...indices.slice(i + 1)];
    for (const rem of permutations(rest)) {
      result.push([indices[i], ...rem]);
    }
  }
  return result;
}

/**
 * Orders a day's selected visits to respect fixed ClassSession time windows,
 * not just raw travel distance — e.g. a school with a 10am class must be
 * reachable before a school with an 11am class even if it's geographically
 * further out of the way. Flexible (no-class) visits have no fixed window
 * and can slot in wherever minimizes travel.
 *
 * Chooses, among all candidate orderings, the one that is fully feasible
 * (every fixed-window visit reached on time) with the least total travel
 * time; if none is fully feasible, the one with the least total lateness.
 * Schools that end up arriving late are flagged via `conflictSchoolIds` so
 * the UI can surface a warning instead of silently proposing a bad order.
 */
function orderByFeasibleSchedule<T extends SchedulableCandidate>(
  candidates: T[],
  durations: number[][]
): { order: T[]; conflictSchoolIds: Set<string> } {
  const n = candidates.length;
  if (n <= 1) return { order: candidates, conflictSchoolIds: new Set() };

  const indices = Array.from({ length: n }, (_, i) => i);
  const chronological = indices
    .slice()
    .sort((a, b) => timeToMins(candidates[a].startTime) - timeToMins(candidates[b].startTime));

  let bestOrder = chronological;
  let bestMetrics = evaluateOrder(chronological, candidates, durations);

  if (n <= MAX_PERMUTATION_STOPS) {
    for (const perm of permutations(indices)) {
      const metrics = evaluateOrder(perm, candidates, durations);
      const better =
        (metrics.feasible && !bestMetrics.feasible) ||
        (metrics.feasible === bestMetrics.feasible &&
          (metrics.totalLatenessMin < bestMetrics.totalLatenessMin ||
            (metrics.totalLatenessMin === bestMetrics.totalLatenessMin &&
              metrics.totalTravelSec < bestMetrics.totalTravelSec)));
      if (better) {
        bestOrder = perm;
        bestMetrics = metrics;
      }
    }
  }

  const conflictSchoolIds = new Set<string>();
  for (const idx of bestMetrics.lateIndices) {
    conflictSchoolIds.add(candidates[idx].schoolId);
  }

  return { order: bestOrder.map((i) => candidates[i]), conflictSchoolIds };
}
