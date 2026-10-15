import type { VisitInfo } from "./types";
import { haversineMeters } from "./geo";

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
  const own = v.startTime && v.endTime && HHMM.test(v.startTime) && HHMM.test(v.endTime)
    ? { start: v.startTime, end: v.endTime }
    : null;
  const start = v.classStartTime && HHMM.test(v.classStartTime) ? v.classStartTime : v.startTime;
  const end = v.classEndTime && HHMM.test(v.classEndTime) ? v.classEndTime : v.endTime;
  if (!start || !end || !HHMM.test(start) || !HHMM.test(end)) return own;
  // A visit carrying a whole period of its own (added by hand, postponed:
  // anything over the planner's 30-minute slot) IS that class. If its class
  // fields say otherwise they are another day's — a card postponed before
  // 2026-10-15 kept Wednesday's 12:30–13:50 Beginning Band on Thursday's
  // 13:40–15:05 Drumline. Its own times win then.
  if (own && toMin(own.end) - toMin(own.start) > 30 && (own.start !== start || own.end !== end)) return own;
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
      // Only a slot inside the class: a visit carrying another class's
      // times must never be put where nothing is taught.
      if (e - s > 0 && e - s <= 30 && s >= cs && e <= ce) {
        return { start: toHHMM(s), end: toHHMM(e), label: WINDOW_LABELS.recommended };
      }
      return { start: range.start, end: toHHMM(cs + twenty), label: WINDOW_LABELS.recommended };
    }
  }
}

export type ResolvedWindow = { start: string; end: string; label: string; conflict: boolean };

/** Same assumption as the planner's own drivability check (proposeVisits). */
const ASSUMED_METRES_PER_MIN = 500;
const LATE_TOLERANCE_MIN = 5;

function travelMinutes(a: VisitInfo, b: VisitInfo): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  if (a.schoolId === b.schoolId) return 0;
  return haversineMeters(a.lat, a.lng, b.lat, b.lng) / ASSUMED_METRES_PER_MIN;
}

/**
 * Every visit's window, a day at a time, so visits on the same day don't
 * collide (Emilio, 2026-10-15: Henry E. S. Reeves and Lakeview, both
 * 13:05–14:05, both went on the calendar at 13:05–13:25).
 *
 * A visit following the "Recommended" default with no 20-minute slot of its
 * own (added by hand, postponed) may take either end of its class: the first
 * 20 minutes, or the last 20 if the first would clash with — or leave no time
 * to drive from — a visit already placed. Anything the manager chose
 * explicitly stays exactly where they put it. A visit that can't be reached in
 * time either way is flagged `conflict`, never moved somewhere impossible.
 */
export function resolveDayWindows(
  visits: VisitInfo[],
  choiceFor: (v: VisitInfo) => VisitWindow | undefined,
  fallback: VisitWindow,
  dayKeyOf: (v: VisitInfo) => string,
): Map<VisitInfo, ResolvedWindow> {
  const out = new Map<VisitInfo, ResolvedWindow>();
  const byDay = new Map<string, VisitInfo[]>();
  for (const v of visits) {
    const key = dayKeyOf(v);
    byDay.set(key, [...(byDay.get(key) ?? []), v]);
  }

  for (const day of byDay.values()) {
    type Placed = { v: VisitInfo; start: number; end: number };
    const placed: Placed[] = [];
    // Minutes late reaching `cand` (or leaving it for the next stop), given
    // what is already placed; 0 when it fits.
    const lateness = (v: VisitInfo, start: number, end: number) => {
      let worst = 0;
      for (const p of placed) {
        if (p.start <= start) worst = Math.max(worst, p.end + travelMinutes(p.v, v) - start);
        if (p.start >= start) worst = Math.max(worst, end + travelMinutes(v, p.v) - p.start);
      }
      return worst;
    };

    const flexible: { v: VisitInfo; options: { start: string; end: string; label: string }[] }[] = [];
    for (const v of day) {
      const choice = choiceFor(v);
      const resolved = resolveVisitWindow(v, choice, fallback);
      if (!resolved) continue;
      const mode = (choice ?? fallback).mode;
      const range = classRange(v);
      const hasOwnSlot = resolved.start === v.startTime && resolved.end === v.endTime;
      if (!choice && mode === "recommended" && range && !hasOwnSlot) {
        const first = resolveVisitWindow(v, { mode: "first" }, fallback)!;
        const last = resolveVisitWindow(v, { mode: "last" }, fallback)!;
        const options = [first, last].map((w) => ({ ...w, label: WINDOW_LABELS.recommended }));
        flexible.push({ v, options: first.start === last.start ? [options[0]] : options });
        continue;
      }
      placed.push({ v, start: toMin(resolved.start), end: toMin(resolved.end) });
      out.set(v, { ...resolved, conflict: false });
    }

    // Earliest class first, each taking the first end of its class that fits.
    flexible.sort((a, b) => toMin(a.options[0].start) - toMin(b.options[0].start));
    for (const { v, options } of flexible) {
      const scored = options.map((o) => ({ o, late: lateness(v, toMin(o.start), toMin(o.end)) }));
      const pick = scored.find((x) => x.late <= LATE_TOLERANCE_MIN) ?? scored.reduce((a, b) => (b.late < a.late ? b : a));
      placed.push({ v, start: toMin(pick.o.start), end: toMin(pick.o.end) });
      out.set(v, { ...pick.o, conflict: false });
    }

    // Then flag anything still unreachable, the manager's own choices included.
    placed.sort((a, b) => a.start - b.start);
    for (let i = 1; i < placed.length; i += 1) {
      const prev = placed[i - 1];
      const cur = placed[i];
      if (prev.end + travelMinutes(prev.v, cur.v) - cur.start > LATE_TOLERANCE_MIN) {
        const w = out.get(cur.v);
        if (w) out.set(cur.v, { ...w, conflict: true });
      }
    }
  }
  return out;
}
