/**
 * proposeVisitsForWeek — the single visit planner for YMU (Phase 2+).
 *
 * CONTRACT:
 *   Input:  prisma, weekStart (any date in the target week), options.regionId
 *   Output: ProposedVisit[] — at most one entry per school, covering Mon–Fri
 *
 *   ELIGIBILITY (hard rule):
 *     A school is eligible if it belongs to the RM's region, has not been
 *     visited within its frequency window (default: BIWEEKLY = 14 days), AND
 *     teaches a class that day. A day a school does not teach is not a visit,
 *     and a school with nothing on its calendar this week is not proposed at
 *     all — there is no "admin / catch-up" fallback.
 *
 *   WHAT A VISIT IS:
 *     A drop-in on roughly the first or the last OBSERVATION_MINUTES of a
 *     class, not attendance at all of it. So each class offers two ways in,
 *     and two classes running at the same hour can both be visited.
 *
 *   BUILDING A DAY (the rule, in the RM's words: close together, and teaching
 *   that day):
 *     Days are taken richest-first, not Monday-first — no day has to be
 *     filled. Each is seeded with the most overdue school teaching then, and
 *     grown by adding the school whose next drop-in comes soonest, nearest
 *     first among equal times, and only if the whole day stays drivable:
 *     every stop reachable from the previous one before its window opens,
 *     measured straight-line at a pessimistic urban speed.
 *
 *   ORDERING:
 *     Once a day's stops are fixed they are ordered chronologically, then
 *     refined against real road times when a distanceService is available
 *     (see orderByFeasibleSchedule). Stops that cannot be reached on time in
 *     any ordering are flagged with scheduleConflict=true.
 */

import { PrismaClient } from "@prisma/client";
import type { FrequencyType } from "@prisma/client";
import { startOfWeek } from "date-fns";
import {
  addDaysToDayKey,
  dayKeyInAppZone,
  formatTimeInAppZone,
  minutesOfDayInAppZone,
  mondayOfDayKey,
  zonedDayStart,
} from "@/lib/timezone";
import type { LatLng } from "./distance/types";
import { getCachedTravelMatrix } from "@/lib/routing/cachedDistanceMatrix";
import { haversineMeters } from "@/lib/geo";
import type { ProposedVisit, ProposeVisitsOptions, WorkWindow } from "./types";
import { getDefaultWorkWindow, getFrequencyDays } from "./types";
import { activeRulesBySchool, lastContactBySchool } from "@/lib/cadence";
import { isAfterschoolClass } from "@/lib/afterschool";

// TODO Phase 3: make configurable per RM in settings
const DEFAULT_MAX_VISITS_PER_DAY = 4;
const DEFAULT_MAX_VISITS_PER_WEEK = 12;

const CLASS_SCORE_BONUS = 20;

// Straight-line metres covered per minute of driving, used only to reject
// impossible sequences while building a day. Deliberately pessimistic — Miami
// surface streets plus parking and walking in — and never used for the times
// shown to the user, which come from the routing service.
const ASSUMED_METRES_PER_MIN = 500;

// A visit is a drop-in, not attendance at the whole class: the manager watches
// roughly the first or the last twenty minutes. That is what makes two classes
// running at the same hour both visitable, so every schedule check below works
// on these windows rather than on full class times.
const OBSERVATION_MINUTES = 20;

/** The opening and closing windows of a class — the two ways to drop in. */
function observationWindows(start: Date, end: Date): { start: Date; end: Date }[] {
  const lengthMins = (end.getTime() - start.getTime()) / 60_000;
  if (lengthMins <= OBSERVATION_MINUTES) return [{ start, end }];

  const openingEnd = new Date(start.getTime() + OBSERVATION_MINUTES * 60_000);
  const closingStart = new Date(end.getTime() - OBSERVATION_MINUTES * 60_000);
  return [
    { start, end: openingEnd },
    { start: closingStart, end },
  ];
}
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Stand-in "days since last visit" for a school with no visit on record, big
 * enough to outrank any real gap when candidates are scored. Never shown.
 */
const NEVER_VISITED_RANK = 999;

/**
 * How long a school can go without anyone physically turning up before it is
 * called out. Deliberately longer than any cadence: this is not "due", it is
 * "nobody has been in a fortnight", which a run of phone calls can hide.
 */
const NOT_SEEN_IN_PERSON_DAYS = 14;
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
  const programmes = options?.programmes ?? "exclude-afterschool";
  const onlyAfterschool = programmes === "only-afterschool";

  // Normalised through Miami rather than the host's zone: date-fns startOfWeek
  // reads the same instant as a different weekday depending on where the code
  // runs, which had this returning the previous week outside UTC. Day keys are
  // stepped as calendar dates so a DST change can't drift the boundary either.
  const weekStartKey = mondayOfDayKey(dayKeyInAppZone(weekStart));
  const weekDayKeys = Array.from({ length: 5 }, (_, i) => addDaysToDayKey(weekStartKey, i));
  const weekDates = weekDayKeys.map(zonedDayStart);
  const weekStartNorm = weekDates[0];
  const weekEnd = zonedDayStart(addDaysToDayKey(weekStartKey, 5));
  const currentWeek = getWeekNumber(weekStartNorm);

  // Fetch all data in parallel
  const schoolWhere = regionId
    // isOffice: the planner proposes schools to visit on a cadence; the office
    // is neither on a cadence nor a school.
    ? { active: true, isOffice: false, regionId }
    : { active: true, isOffice: false };

  // Planning afterschool means planning the schools that HAVE afterschool, not
  // all 109 with the rest showing up as "no class scheduled this week". Asked of
  // the whole table rather than this week's, so a school whose programme runs
  // next week does not vanish from the cadence today.
  let afterschoolSchoolIds: string[] | null = null;
  if (onlyAfterschool) {
    // Classified in code, not with a SQL LIKE on "afterschool": the titles are
    // "After School ...", "Tutoring", "Fusion Ensemble", and a LIKE would have
    // reproduced exactly the blind spot this replaced. The weak tier needs the
    // start time, which is why the rows come back with it.
    const rows = await prisma.classSession.findMany({
      select: { schoolId: true, startDateTime: true, subject: { select: { name: true } } },
    });
    afterschoolSchoolIds = [
      ...new Set(
        rows
          .filter((r) => isAfterschoolClass(r.subject?.name, r.startDateTime))
          .map((r) => r.schoolId)
      ),
    ];
  }

  const scopedSchoolWhere = afterschoolSchoolIds
    ? { ...schoolWhere, id: { in: afterschoolSchoolIds } }
    : schoolWhere;

  const [schools, visitRules, doneVisits, classSessionsInWeek] = await Promise.all([
    prisma.school.findMany({
      where: scopedSchoolWhere,
      select: { id: true, name: true, zipCode: true, lat: true, lng: true },
    }),
    prisma.visitRule.findMany({
      where: { school: scopedSchoolWhere },
      orderBy: { createdAt: "desc" }, // latest rule first
    }),
    prisma.visit.findMany({
      where: { status: "DONE", school: scopedSchoolWhere },
      orderBy: { plannedStartDateTime: "desc" },
      // Mode matters here: a phone call is contact, not a visit. Counting one as
      // the school's last visit reset its cadence and stopped it being proposed,
      // so a school could go a term without anybody walking in.
      //
      // Who visited matters too. A school is somebody's responsibility, and
      // another region's RM dropping in doesn't discharge it: Edison Park is
      // East's to cover, so Central visiting it must still leave it unvisited on
      // East's plan.
      select: {
        schoolId: true,
        plannedStartDateTime: true,
        mode: true,
        school: { select: { regionId: true } },
        visitedBy: { select: { regionId: true } },
      },
    }),
    prisma.classSession.findMany({
      where: {
        startDateTime: { gte: weekStartNorm },
        endDateTime: { lt: weekEnd },
        school: scopedSchoolWhere,
      },
      // The teacher comes along so the visit can record who was actually
      // observed, rather than leaving it to "whoever teaches here".
      include: { subject: true, teacher: true },
    }),
  ]);

  if (schools.length === 0) return [];

  // The cadence is about being there, so it tracks in-person visits only, and
  // only those made by whoever covers the school. Both rules live in
  // src/lib/cadence.ts because the dashboard has to answer "due this week" with
  // exactly the same arithmetic this function plans from.
  const { lastInPerson: lastVisitBySchool, lastRemote: lastRemoteBySchool } =
    lastContactBySchool(doneVisits);

  const activeRuleBySchool = activeRulesBySchool(visitRules);

  // Class sessions indexed by schoolId+dayStr for O(1) lookup
  const sessionsBySchoolDay = new Map<string, typeof classSessionsInWeek[number][]>();
  for (const s of classSessionsInWeek) {
    // The one line that decides whose plan this is. The classifier needs the
    // start time as well as the title: "Marching Band" is afterschool at Carol
    // City at 15:00 and a regular class at Homestead at 07:40.
    if (isAfterschoolClass(s.subject?.name, s.startDateTime) !== onlyAfterschool) continue;
    const key = `${s.schoolId}:${dayKeyInAppZone(s.startDateTime)}`;
    if (!sessionsBySchoolDay.has(key)) sessionsBySchoolDay.set(key, []);
    sessionsBySchoolDay.get(key)!.push(s);
  }

  // Miami's today, not the host's — the boundary decides which of the week's
  // days count as already past.
  const today = zonedDayStart(dayKeyInAppZone(new Date()));

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
    classStartTime?: string;
    classEndTime?: string;
    score: number;
    reason: string;
    subjectName?: string;
    teacherId?: string;
    teacherName?: string;
    notSeenInPerson: boolean;
    weeksSinceInPerson: number | null;
    noClassWarning: boolean;
    visitRuleFrequency: string;
    visitRuleNote?: string;
    scheduleConflict?: boolean;
    /**
     * Every way to drop in on this school that day, earliest first — the
     * opening and closing window of each class it teaches.
     */
    slots: {
      start: Date;
      end: Date;
      classStart: Date;
      classEnd: Date;
      subjectName?: string;
      teacherId?: string;
      teacherName?: string;
    }[];
  };

  // Build candidate list: one entry per (eligible school × weekday)
  const candidatesByDay = new Map<string, Candidate[]>();

  for (const school of schools) {
    const rule = activeRuleBySchool.get(school.id);
    const freq: FrequencyType = rule?.frequencyType ?? "BIWEEKLY";
    const lastVisit = lastVisitBySchool.get(school.id);
    const lastRemote = lastRemoteBySchool.get(school.id);
    const daysSinceRemote = lastRemote
      ? Math.floor((today.getTime() - lastRemote.getTime()) / MS_PER_DAY)
      : null;
    const lastVisitWeek = lastVisit ? getWeekNumber(lastVisit) : 0;

    if (!shouldProposeThisWeek(freq, lastVisitWeek, currentWeek)) continue;

    // Collected across the whole week so that, once we know whether this
    // school teaches at all this week, the days it doesn't can be dropped.
    const schoolCandidates: Candidate[] = [];

    // A school with no visit on record ranks above any merely-overdue one. The
    // number is a sort key, not a duration — reading it as one is what produced
    // "Overdue by 985 days" on screen for a school nobody had ever been to.
    const neverVisited = lastVisit == null;
    const daysSinceLast = lastVisit
      ? Math.floor((today.getTime() - lastVisit.getTime()) / MS_PER_DAY)
      : NEVER_VISITED_RANK;
    const freqDays = getFrequencyDays(freq);
    const isOverdue = daysSinceLast >= freqDays;
    const baseScore = isOverdue
      ? 100 + (daysSinceLast - freqDays) * 5
      : Math.max(1, daysSinceLast);
    const visitRuleFrequency = rule ? rule.frequencyType : "DEFAULT";
    const visitRuleNote = rule?.reason ?? undefined;

    for (const day of weekDates) {
      const dayStr = dayKeyInAppZone(day);
      const key = `${school.id}:${dayStr}`;
      const sessions = sessionsBySchoolDay.get(key) ?? [];

      // Every in-window class this school teaches that day, not just the first.
      // A school often teaches twice — Carrie P. Meek runs 10:05 and 12:10 —
      // and which one to attend depends on the rest of the day's route, so the
      // choice is deferred to the clustering below.
      const daySessions = sessions
        .filter((s) => {
          // Against the RM's working day in Miami. getHours() would read the
          // host's clock, so the same class fell inside the window on one
          // server and outside it on another.
          const startMins = minutesOfDayInAppZone(s.startDateTime);
          const endMins = minutesOfDayInAppZone(s.endDateTime);
          return isInWorkWindow(startMins, endMins, workWindow);
        })
        .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime());

      const bestSession = daySessions[0];
      const hasClass = bestSession !== undefined;
      const score = baseScore + (hasClass ? CLASS_SCORE_BONUS : 0);

      // Never-visited is checked first: it is also "overdue", and letting that
      // branch win meant this message was unreachable.
      const baseReason = neverVisited
        ? "Never visited in person"
        : isOverdue
          ? `Overdue by ${daysSinceLast - freqDays} days`
          : `Due in ${freqDays - daysSinceLast} days`;
      // Said alongside, not instead: a call is worth knowing about and is not a
      // reason to skip the school.
      const remoteNote =
        daysSinceRemote != null
          ? daysSinceRemote === 0
            ? " · called today"
            : ` · last contacted remotely ${daysSinceRemote}d ago`
          : "";
      const reasonText = baseReason + remoteNote;
      // Flagged apart from "overdue", which a school can be by a single day.
      // This is the case worth interrupting someone about: nobody has walked in
      // for a fortnight, whatever the cadence says and however many calls there
      // have been in between.
      const weeksSinceInPerson = neverVisited ? null : Math.floor(daysSinceLast / 7);
      const notSeenInPerson = neverVisited || daysSinceLast >= NOT_SEEN_IN_PERSON_DAYS;

      const candidate: Candidate = {
        schoolId: school.id,
        schoolName: school.name,
        dayStr,
        zipCode: school.zipCode,
        lat: school.lat ?? null,
        lng: school.lng ?? null,
        date: hasClass ? bestSession.startDateTime : new Date(`${dayStr}T09:00:00`),
        startTime: hasClass ? formatTimeInAppZone(bestSession.startDateTime) : "09:00",
        endTime: hasClass ? formatTimeInAppZone(bestSession.endDateTime) : "10:00",
        score,
        reason: reasonText,
        subjectName: bestSession?.subject?.name,
        notSeenInPerson,
        weeksSinceInPerson,
        teacherId: bestSession?.teacher?.externalId ? bestSession.teacher.id : undefined,
        teacherName: bestSession?.teacher?.externalId ? bestSession.teacher.name : undefined,
        noClassWarning: !hasClass,
        visitRuleFrequency,
        visitRuleNote,
        slots: daySessions
          .flatMap((s) =>
            observationWindows(s.startDateTime, s.endDateTime).map((w) => ({
              start: w.start,
              end: w.end,
              classStart: s.startDateTime,
              classEnd: s.endDateTime,
              subjectName: s.subject?.name,
              // Only a teacher imported from YMU-A; a leftover calendar row is a
              // school name, not a person to attribute a rating to.
              teacherId: s.teacher?.externalId ? s.teacher.id : undefined,
              teacherName: s.teacher?.externalId ? s.teacher.name : undefined,
            }))
          )
          .sort((a, b) => a.start.getTime() - b.start.getTime()),
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
  // A school is only added if its class times still leave a route you could
  // actually drive: three classes that all start at 10:05 are close together
  // and useless. Where a school teaches more than once that day, the slot that
  // fits the day being built is the one chosen.
  //
  // Distance here is straight-line, not road time: choosing the cluster needs
  // every pair of candidates compared, which would be hundreds of routing
  // calls per day. Road time still decides the order of the stops once the
  // cluster is fixed, below.
  const scheduledSchoolIds = new Set<string>();
  const chosenByDay = new Map<string, Candidate[]>();
  let weeklyCount = 0;

  type Slot = {
    start: Date;
    end: Date;
    classStart: Date;
    classEnd: Date;
    subjectName?: string;
    teacherId?: string;
    teacherName?: string;
  };
  type Stop = { candidate: Candidate; slot: Slot };

  const minutesOf = (d: Date) => minutesOfDayInAppZone(d);

  const metresBetween = (a: Candidate, b: Candidate): number | null =>
    a.lat != null && a.lng != null && b.lat != null && b.lng != null
      ? haversineMeters(a.lat, a.lng, b.lat, b.lng)
      : null;

  const distanceToCluster = (candidate: Candidate, cluster: Stop[]): number => {
    let nearest = Infinity;
    for (const member of cluster) {
      const metres = metresBetween(candidate, member.candidate);
      if (metres != null) nearest = Math.min(nearest, metres);
    }
    return nearest;
  };

  /** Can these stops be driven in start-time order without missing a class? */
  const isDrivable = (stops: Stop[]): boolean => {
    const ordered = [...stops].sort((a, b) => minutesOf(a.slot.start) - minutesOf(b.slot.start));
    for (let i = 1; i < ordered.length; i += 1) {
      const from = ordered[i - 1];
      const to = ordered[i];
      const metres = metresBetween(from.candidate, to.candidate);
      const travelMins = metres == null ? 0 : metres / ASSUMED_METRES_PER_MIN;
      if (minutesOf(from.slot.end) + travelMins > minutesOf(to.slot.start) + LATE_TOLERANCE_MIN) {
        return false;
      }
    }
    return true;
  };

  // Days are filled richest-first, not Monday-first. There is no obligation to
  // put something on every day: a Wednesday where one school teaches is better
  // left empty than spent on a lone stop, when that school can instead join a
  // Thursday that already has three others nearby.
  //
  // Days that have already been and gone are filled last. Mid-week, a school is
  // only schedulable once, so letting Monday through Thursday claim schools
  // leaves today's plan picked over — on Friday morning Brownsville and Charles
  // R. Drew were both missing because Thursday had already spent them.
  const isPast = (day: Date) => day < today;
  const daysByOpportunity = [...weekDates].sort((a, b) => {
    if (isPast(a) !== isPast(b)) return isPast(a) ? 1 : -1;

    const aCount = (candidatesByDay.get(dayKeyInAppZone(a)) ?? []).length;
    const bCount = (candidatesByDay.get(dayKeyInAppZone(b)) ?? []).length;
    return bCount !== aCount ? bCount - aCount : a.getTime() - b.getTime();
  });

  for (const day of daysByOpportunity) {
    if (weeklyCount >= maxVisitsPerWeek) break;

    const dayStr = dayKeyInAppZone(day);
    const pool = (candidatesByDay.get(dayStr) ?? [])
      .filter((c) => !scheduledSchoolIds.has(c.schoolId))
      .sort((a, b) => b.score - a.score);
    if (pool.length === 0) continue;

    const room = Math.min(maxVisitsPerDay, maxVisitsPerWeek - weeklyCount);
    // Seed with the most overdue school teaching that day, at its first class.
    const seed = pool.shift()!;
    const cluster: Stop[] = [{ candidate: seed, slot: seed.slots[0] }];

    while (cluster.length < room && pool.length > 0) {
      let bestIndex = -1;
      let bestSlot: Slot | null = null;
      let bestDistance = Infinity;

      for (let i = 0; i < pool.length; i += 1) {
        const candidate = pool[i];
        // Earliest slot that still leaves the day drivable.
        const slot = candidate.slots.find((s) => isDrivable([...cluster, { candidate, slot: s }]));
        if (!slot) continue;

        const distance = distanceToCluster(candidate, cluster);
        // Fill the day chronologically, nearest first among equals. Taking the
        // nearest school outright instead loses more than it gains: grabbing a
        // 13:40 class because it is a mile away rules out every other 13:40
        // class, when a 12:10 stop first would have left the afternoon free.
        const isBetter =
          bestIndex === -1 ||
          slot.start.getTime() < bestSlot!.start.getTime() ||
          (slot.start.getTime() === bestSlot!.start.getTime() && distance < bestDistance);

        if (isBetter) {
          bestDistance = distance;
          bestIndex = i;
          bestSlot = slot;
        }
      }

      // Nothing left that both fits the schedule and is reachable.
      if (bestIndex === -1 || !bestSlot) break;

      cluster.push({ candidate: pool[bestIndex], slot: bestSlot });
      pool.splice(bestIndex, 1);
    }

    for (const stop of cluster) {
      scheduledSchoolIds.add(stop.candidate.schoolId);
      weeklyCount += 1;
    }
    // Bake the chosen slot in, so downstream sees one concrete class time.
    chosenByDay.set(
      dayStr,
      cluster.map(({ candidate, slot }) => ({
        ...candidate,
        date: slot.start,
        startTime: formatTimeInAppZone(slot.start),
        endTime: formatTimeInAppZone(slot.end),
        classStartTime: formatTimeInAppZone(slot.classStart),
        classEndTime: formatTimeInAppZone(slot.classEnd),
        subjectName: slot.subjectName,
        teacherId: slot.teacherId,
        teacherName: slot.teacherName,
        notSeenInPerson: candidate.notSeenInPerson,
        weeksSinceInPerson: candidate.weeksSinceInPerson,
      }))
    );
  }

  // Then order each day's picks: chronological, refined by travel time.
  const proposed: ProposedVisit[] = [];

  for (const day of weekDates) {
    const dayStr = dayKeyInAppZone(day);
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
        classStartTime: c.classStartTime,
        classEndTime: c.classEndTime,
        score: c.score,
        reason: c.reason,
        subjectName: c.subjectName,
        teacherId: c.teacherId,
        teacherName: c.teacherName,
        notSeenInPerson: c.notSeenInPerson,
        weeksSinceInPerson: c.weeksSinceInPerson,
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
