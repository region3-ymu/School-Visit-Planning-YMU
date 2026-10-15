import type { VisitInfo } from "./types";

/**
 * Which slice of a class a visit occupies — what goes on the RM's Google
 * Calendar (#55, Emilio Medrano, 2026-10-15).
 *
 * The export used to send whatever startTime/endTime a visit carried: the
 * planner's 20-minute recommended drop-in for planned visits, the whole class
 * for ones added by hand or postponed. So one week came out mixed. How long a
 * visit lasts is the manager's call, so it is now chosen: a default for the
 * week, and an override per visit.
 */

export type WindowMode = "recommended" | "first" | "last" | "whole" | "custom";

export type VisitWindow = {
  mode: WindowMode;
  /** custom only: "HH:MM" start inside (or around) the class. */
  start?: string;
  /** custom only: length in minutes. */
  minutes?: number;
};

export const DEFAULT_WINDOW: VisitWindow = { mode: "recommended" };

export const WINDOW_LABELS: Record<WindowMode, string> = {
  recommended: "Recommended (20 min)",
  first: "First 20 min",
  last: "Last 20 min",
  whole: "Whole class",
  custom: "Custom",
};

const HHMM = /^\d{2}:\d{2}$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => {
  const c = Math.max(0, Math.min(23 * 60 + 59, m));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};

/** The key a per-visit choice is stored under: one class slot, one day. */
export function visitWindowKey(schoolId: string, dayKey: string, classStart: string | undefined): string {
  return `${schoolId}|${dayKey}|${classStart ?? ""}`;
}

/** The class period, falling back to the visit's own times for drop-ins. */
function classRange(v: VisitInfo): { start: string; end: string } | null {
  const start = v.classStartTime && HHMM.test(v.classStartTime) ? v.classStartTime : v.startTime;
  const end = v.classEndTime && HHMM.test(v.classEndTime) ? v.classEndTime : v.endTime;
  if (!start || !end || !HHMM.test(start) || !HHMM.test(end)) return null;
  return { start, end };
}

/**
 * The start and end a visit exports with. `choice` is the visit's own
 * override, if any; `fallback` the week's default.
 */
export function resolveVisitWindow(
  v: VisitInfo,
  choice: VisitWindow | undefined,
  fallback: VisitWindow,
): { start: string; end: string; label: string } | null {
  const range = classRange(v);
  if (!range) return null;
  const w = choice ?? fallback;
  const cs = toMin(range.start);
  const ce = Math.max(toMin(range.end), cs + 1);
  const twenty = Math.min(20, ce - cs);
  switch (w.mode) {
    case "whole":
      return { start: range.start, end: toHHMM(ce), label: WINDOW_LABELS.whole };
    case "first":
      return { start: range.start, end: toHHMM(cs + twenty), label: WINDOW_LABELS.first };
    case "last":
      return { start: toHHMM(ce - twenty), end: toHHMM(ce), label: WINDOW_LABELS.last };
    case "custom": {
      const start = w.start && HHMM.test(w.start) ? toMin(w.start) : cs;
      const minutes = Math.max(5, Math.min(240, Math.round(w.minutes ?? 20)));
      return { start: toHHMM(start), end: toHHMM(start + minutes), label: `${minutes} min` };
    }
    case "recommended":
    default: {
      // The planner's own 20-minute slot when it made one; a visit that only
      // carries the whole class (added by hand, postponed) gets the first 20.
      const s = v.startTime && HHMM.test(v.startTime) ? toMin(v.startTime) : cs;
      const e = v.endTime && HHMM.test(v.endTime) ? toMin(v.endTime) : ce;
      if (e - s > 0 && e - s <= 30) {
        return { start: toHHMM(s), end: toHHMM(e), label: WINDOW_LABELS.recommended };
      }
      return { start: range.start, end: toHHMM(cs + twenty), label: WINDOW_LABELS.recommended };
    }
  }
}
