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
  /** True when no ClassSession exists for this school on this day */
  noClassWarning?: boolean;
  /** The school's active VisitRule frequency, or "DEFAULT" if using the default BIWEEKLY */
  visitRuleFrequency?: string;
  /** The reason text from the active VisitRule override, if any */
  visitRuleNote?: string;
  /** True when no feasible same-day ordering reaches this visit within its class window */
  scheduleConflict?: boolean;
}

export interface ProposeVisitsOptions {
  regionId?: string;
  maxVisitsPerWeek?: number;
  maxVisitsPerDay?: number;
  workWindow?: WorkWindow;
  distanceService?: import("./distance/types").IDistanceService;
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
