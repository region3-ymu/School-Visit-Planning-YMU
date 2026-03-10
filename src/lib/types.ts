export type DayType = "A" | "B" | "Planning" | "Holiday";

export interface SchoolAvailabilityRule {
  dayType?: DayType;
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

export interface CalendarDayInfo {
  id: string;
  date: Date;
  dayType: DayType;
  description?: string;
}

export interface VisitInfo {
  schoolId: string;
  schoolName: string;
  zipCode: string;
  date: Date;
  score: number;
  reason: string;
  startTime?: string;
  endTime?: string;
  isPinned: boolean;
  isCompleted?: boolean;
  isSkipped?: boolean;
  viableOptionsThisWeek?: ViableOption[];
  warning?: string;
}
