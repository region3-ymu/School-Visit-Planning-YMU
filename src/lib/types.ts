export interface SchoolAvailabilityRule {
  /** Legacy A/B day type — retained in stored JSON but no longer matched by the planner. */
  dayType?: string;
  weekday?: string; // "Monday", "Tuesday", etc.
  start: string; // HH:mm (24-hour)
  end: string;   // HH:mm (24-hour)
  class?: string;
  note?: string;
}

export type FrequencyTarget = "weekly" | "bi-weekly" | "monthly";

export interface ViableOption {
  date: string; // yyyy-MM-dd
  rule: SchoolAvailabilityRule;
}

export interface VisitInfo {
  schoolId: string;
  schoolName: string;
  zipCode: string;
  lat?: number;
  lng?: number;
  date: Date;
  score: number;
  reason: string;
  startTime?: string;
  endTime?: string;
  classStartTime?: string;
  classEndTime?: string;
  /** Program/subject name for the class at this time (e.g. "Drumline", "Modern Band") */
  subjectName?: string;
  teacherId?: string;
  teacherName?: string;
  /** Nobody has physically been to this school in a fortnight or more. */
  notSeenInPerson?: boolean;
  weeksSinceInPerson?: number | null;
  isPinned: boolean;
  isCompleted?: boolean;
  isSkipped?: boolean;
  viableOptionsThisWeek?: ViableOption[];
  warning?: string;
  /** True when no ClassSession exists for this school on this day (admin/catch-up visit) */
  noClassWarning?: boolean;
  /** The school's active VisitRule frequency, or "DEFAULT" if using the default BIWEEKLY rule */
  visitRuleFrequency?: string;
  /** The reason text from the active VisitRule override, if any */
  visitRuleNote?: string;
  /** True when no feasible same-day ordering reaches this visit within its class window */
  scheduleConflict?: boolean;
}
