import type { FrequencyType } from "@prisma/client";

export interface WorkWindow {
  start: string; // "08:00" HH:mm 24h
  end: string;   // "17:00"
}

export interface ProposedVisit {
  schoolId: string;
  schoolName: string;
  zipCode: string;
  lat?: number;
  lng?: number;
  date: Date;
  /** The 20-minute drop-in window to actually be there. */
  startTime: string;
  endTime: string;
  /** The full class this drop-in sits inside, for context on the card. */
  classStartTime?: string;
  classEndTime?: string;
  score: number;
  reason: string;
  subjectName?: string;
  subjectId?: string;
  teacherId?: string;
  teacherName?: string;
  /** Nobody has physically been to this school in a fortnight or more. */
  notSeenInPerson?: boolean;
  weeksSinceInPerson?: number | null;
  /** True when no ClassSession exists for this school on this day */
  noClassWarning?: boolean;
  /** The school's active VisitRule frequency, or "DEFAULT" if using the default BIWEEKLY */
  visitRuleFrequency?: string;
  /** The reason text from the active VisitRule override, if any */
  visitRuleNote?: string;
  /** True when no feasible same-day ordering reaches this visit within its class window */
  scheduleConflict?: boolean;
}

/**
 * Which programmes a plan is about.
 *
 * "exclude" is the Regional Manager's view and the historical behaviour: an
 * afterschool class is somebody else's programme, so it never counted as a
 * reason to visit. "only" is the Afterschool Manager's, who owns exactly those
 * classes across every region — for them the old filter hid the entire job.
 * "all" is for the one Regional Manager who runs an afterschool programme in
 * his own region as well as the school day, so neither filter describes him.
 */
export type ProgrammeScope = "exclude-afterschool" | "only-afterschool" | "all";

/**
 * A stop the user placed by hand, passed in so the auto plan is built AROUND
 * it rather than on top of it.
 *
 * These are never proposed back — getWeeklyPlan owns the pinned rows, because
 * it is the only side that knows they were pinned. What they do here is hold
 * their school out of the auto picks (a school pinned on Monday must not also
 * be offered on Thursday) and join the drivability check for their day, so the
 * schools chosen to go alongside one are schools you could actually reach
 * around it.
 *
 * They deliberately do NOT consume the weekly or daily budget: "+ Add" is
 * described to the user as forcing an EXTRA school into the week, and making a
 * manual addition silently evict an auto visit is exactly the behaviour that
 * reads as the planner moving things by itself.
 */
export interface PinnedStop {
  schoolId: string;
  /** yyyy-MM-dd in Miami. */
  dayKey: string;
  /** HH:mm, the drop-in window the user picked. */
  startTime: string;
  endTime: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * A school+day the user took off the plan.
 *
 * Applied while candidates are built, not to the finished plan: filtering
 * afterwards spent a slot of the weekly budget on a visit that was then thrown
 * away, so every deletion quietly shrank the week.
 */
export interface SkippedStop {
  schoolId: string;
  /** yyyy-MM-dd in Miami. */
  dayKey: string;
}

export interface ProposeVisitsOptions {
  regionId?: string;
  programmes?: ProgrammeScope;
  maxVisitsPerWeek?: number;
  maxVisitsPerDay?: number;
  workWindow?: WorkWindow;
  distanceService?: import("./distance/types").IDistanceService;
  /** Visits the user placed by hand — see PinnedStop. */
  pinned?: PinnedStop[];
  /** School+day pairs the user removed by hand — see SkippedStop. */
  skipped?: SkippedStop[];
}

export function getFrequencyDays(freq: FrequencyType): number {
  switch (freq) {
    case "WEEKLY": return 7;
    case "BIWEEKLY": return 14;
    case "EVERY_3_WEEKS": return 21;
    case "MONTHLY": return 30;
    default: return 14;
  }
}

export function getDefaultWorkWindow(): WorkWindow {
  return {
    start: process.env.PLANNER_WORK_START ?? "08:00",
    end: process.env.PLANNER_WORK_END ?? "17:00",
  };
}
