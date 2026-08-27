import type { FrequencyType } from "@prisma/client";
import { getFrequencyDays } from "@/modules/visitPlanner/types";

/**
 * The visit cadence rules, in one place.
 *
 * These were written inline inside proposeVisits.ts, which was fine while it
 * was the only caller. It is not any more: the dashboard has to answer "how
 * many are due this week" with the same arithmetic the planner uses to decide
 * what to propose, and the last thing this app needs is two screens
 * disagreeing about whether a school has been visited. (It has form: the
 * dashboard's coverage count and the planner once contradicted each other about
 * exactly that.) Both import from here now.
 */

export const MS_PER_DAY = 86_400_000;

/** No VisitRule on a school means every two weeks. */
export const DEFAULT_FREQUENCY: FrequencyType = "BIWEEKLY";

type VisitRow = {
  schoolId: string;
  plannedStartDateTime: Date;
  mode: string;
  school: { regionId: string | null };
  visitedBy: { regionId: string | null } | null;
};

/**
 * Whether a visit counts toward the cadence of the school it was made to.
 *
 * A school is somebody's responsibility, and another region's RM dropping in
 * does not discharge it — Edison Park is East's to cover, so Central visiting
 * it must still leave it unvisited on East's plan. A visit with no author, or
 * one by someone with no region, is counted rather than discarded: it happened,
 * and there is nothing to say it wasn't theirs.
 */
export function visitCoversSchool(
  visitorRegionId: string | null | undefined,
  schoolRegionId: string | null
): boolean {
  const visitorRegion = visitorRegionId ?? null;
  return visitorRegion == null || visitorRegion === schoolRegionId;
}

/**
 * Last in-person visit and last remote contact per school, newest first.
 *
 * `visits` must already be ordered plannedStartDateTime desc — the first row
 * seen for a school wins.
 *
 * The two are kept apart because the cadence is about being there. A phone call
 * is contact worth knowing about, and it is not a reason to skip a school.
 */
export function lastContactBySchool(visits: VisitRow[]): {
  lastInPerson: Map<string, Date>;
  lastRemote: Map<string, Date>;
} {
  const lastInPerson = new Map<string, Date>();
  const lastRemote = new Map<string, Date>();
  for (const v of visits) {
    if (!visitCoversSchool(v.visitedBy?.regionId, v.school.regionId)) continue;
    const target = v.mode === "IN_PERSON" ? lastInPerson : lastRemote;
    if (!target.has(v.schoolId)) target.set(v.schoolId, v.plannedStartDateTime);
  }
  return { lastInPerson, lastRemote };
}

/**
 * The still-active rule per school from a list ordered createdAt desc: the
 * latest one that has not been closed off with an effectiveTo.
 */
export function activeRulesBySchool<T extends { schoolId: string; effectiveTo: Date | null }>(
  rules: T[]
): Map<string, T> {
  const active = new Map<string, T>();
  for (const rule of rules) {
    if (active.has(rule.schoolId)) continue;
    if (rule.effectiveTo === null || rule.effectiveTo === undefined) active.set(rule.schoolId, rule);
  }
  return active;
}

export type CadenceStatus = {
  /** Nobody has been to this school in person, ever. */
  neverVisited: boolean;
  /** Whole days since the last in-person visit; null when there has never been one. */
  daysSinceLast: number | null;
  /** When this school next falls due; null when there is nothing to count from. */
  dueDate: Date | null;
  /** Past its interval already. Never-visited schools are NOT counted here. */
  isOverdue: boolean;
  /** The interval this school is held to, in days. */
  freqDays: number;
};

/**
 * Where a school stands against its interval, as of `today`.
 *
 * neverVisited is deliberately not folded into isOverdue. They are different
 * problems — one school is a few days late, the other has never been seen at
 * all — and a single number that mixes them tells a Regional Manager nothing
 * about which to do something about. The planner already ranks them apart.
 */
export function cadenceStatus(
  lastInPerson: Date | undefined,
  frequency: FrequencyType | null | undefined,
  today: Date
): CadenceStatus {
  const freqDays = getFrequencyDays(frequency ?? DEFAULT_FREQUENCY);
  if (!lastInPerson) {
    return { neverVisited: true, daysSinceLast: null, dueDate: null, isOverdue: false, freqDays };
  }
  const daysSinceLast = Math.floor((today.getTime() - lastInPerson.getTime()) / MS_PER_DAY);
  return {
    neverVisited: false,
    daysSinceLast,
    dueDate: new Date(lastInPerson.getTime() + freqDays * MS_PER_DAY),
    isOverdue: daysSinceLast >= freqDays,
    freqDays,
  };
}
