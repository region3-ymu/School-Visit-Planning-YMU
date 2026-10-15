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

/** What to do about a visit that can't be reached in time. */
export type WindowFix = { visit: VisitInfo; window: VisitWindow; text: string };

export type ResolvedWindow = {
  start: string;
  end: string;
  label: string;
  /** Set when the visit before it ends too late to drive here in time. */
  conflict: {
    fromSchool: string;
    leaveAt: string;
    driveMinutes: number;
    arriveAt: string;
    /** True when no road time was available and the straight-line guess was used. */
    estimated: boolean;
    /** Changes that would make the day work, best first. Empty: postpone one. */
    fixes: WindowFix[];
  } | null;
};

/** The planner's own fallback assumption when there is no road time. */
const ASSUMED_METRES_PER_MIN = 500;
const LATE_TOLERANCE_MIN = 5;
/** Beyond this many free choices in one day, stop trying every combination. */
const MAX_EXHAUSTIVE = 10;

export type DriveMinutes = Record<string, number>;

function drive(a: VisitInfo, b: VisitInfo, road: DriveMinutes): { minutes: number; estimated: boolean } {
  if (a.schoolId === b.schoolId) return { minutes: 0, estimated: false };
  const known = road[`${a.schoolId}|${b.schoolId}`];
  if (known != null) return { minutes: known, estimated: false };
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return { minutes: 0, estimated: true };
  return { minutes: Math.round(haversineMeters(a.lat, a.lng, b.lat, b.lng) / ASSUMED_METRES_PER_MIN), estimated: true };
}

type Option = { start: string; end: string; label: string; window: VisitWindow };
type Slot = { v: VisitInfo; start: number; end: number };

/** Minutes late at the worst stop, and in total, for windows in time order. */
function lateness(slots: Slot[], road: DriveMinutes) {
  const sorted = [...slots].sort((a, b) => a.start - b.start || a.end - b.end);
  let worst = 0;
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const late = sorted[i - 1].end + drive(sorted[i - 1].v, sorted[i].v, road).minutes - sorted[i].start;
    if (late > LATE_TOLERANCE_MIN) {
      worst = Math.max(worst, late);
      total += late;
    }
  }
  return { worst, total };
}

/**
 * Every visit's calendar window, a day at a time, so a day's visits fit
 * together (#62 point 1, Emilio, 2026-10-15: Henry E. S. Reeves and Lakeview,
 * both 13:05–14:05, both went on the calendar at 13:05–13:25).
 *
 * Every visit following the "Recommended" default — planned, added by hand or
 * postponed alike — may take the first or the last 20 minutes of its class
 * (or the planner's own slot, preferred when it works). Every combination for
 * the day is tried against real drive times (`road`, from
 * getDayDriveMinutes; the planner's straight-line guess where missing), and
 * the one that reaches every visit on time wins, earliest slices first among
 * equals. What the manager chose explicitly is never moved. A visit that
 * still can't be reached is flagged with where the drive comes from and the
 * changes that would fix it.
 */
export function resolveDayWindows(
  visits: VisitInfo[],
  choiceFor: (v: VisitInfo) => VisitWindow | undefined,
  fallback: VisitWindow,
  dayKeyOf: (v: VisitInfo) => string,
  road: DriveMinutes = {},
): Map<VisitInfo, ResolvedWindow> {
  const out = new Map<VisitInfo, ResolvedWindow>();
  const byDay = new Map<string, VisitInfo[]>();
  for (const v of visits) byDay.set(dayKeyOf(v), [...(byDay.get(dayKeyOf(v)) ?? []), v]);

  const optionsFor = (v: VisitInfo): Option[] | null => {
    const choice = choiceFor(v);
    const own = resolveVisitWindow(v, choice, fallback);
    if (!own) return null;
    if (choice || fallback.mode !== "recommended") return [{ ...own, window: choice ?? fallback }];
    const list: Option[] = [{ ...own, window: { mode: "recommended" } }];
    for (const mode of ["first", "last"] as const) {
      const w = resolveVisitWindow(v, { mode }, fallback)!;
      if (!list.some((o) => o.start === w.start)) list.push({ ...w, label: WINDOW_LABELS.recommended, window: { mode } });
    }
    return list;
  };
  /** Every slice a manager could pick for this visit, for suggesting fixes. */
  const allSlices = (v: VisitInfo): Option[] =>
    (["first", "last"] as const)
      .map((mode) => ({ ...resolveVisitWindow(v, { mode }, fallback)!, window: { mode } as VisitWindow }))
      .filter((o, i, list) => o.start && list.findIndex((x) => x.start === o.start) === i);

  for (const day of byDay.values()) {
    const entries = day.map((v) => ({ v, options: optionsFor(v) })).filter((e) => e.options) as { v: VisitInfo; options: Option[] }[];

    // Try every combination (2–3 options each, a handful of visits a day);
    // past MAX_EXHAUSTIVE free visits, keep their first option.
    let best: Option[] = entries.map((e) => e.options[0]);
    let bestScore = { worst: Infinity, total: Infinity, moved: Infinity };
    const free = entries.map((e, i) => i).filter((i) => entries[i].options.length > 1).slice(0, MAX_EXHAUSTIVE);
    const pick = entries.map(() => 0);
    const visit = (k: number) => {
      if (k === free.length) {
        const chosen = entries.map((e, i) => e.options[pick[i]]);
        const { worst, total } = lateness(chosen.map((o, i) => ({ v: entries[i].v, start: toMin(o.start), end: toMin(o.end) })), road);
        const moved = pick.reduce((a, b) => a + b, 0);
        if (
          worst < bestScore.worst ||
          (worst === bestScore.worst && (total < bestScore.total || (total === bestScore.total && moved < bestScore.moved)))
        ) {
          best = chosen;
          bestScore = { worst, total, moved };
        }
        return;
      }
      for (let o = 0; o < entries[free[k]].options.length; o += 1) {
        pick[free[k]] = o;
        visit(k + 1);
      }
      pick[free[k]] = 0;
    };
    visit(0);

    const slots: Slot[] = entries.map((e, i) => ({ v: e.v, start: toMin(best[i].start), end: toMin(best[i].end) }));
    const sorted = [...slots].sort((a, b) => a.start - b.start || a.end - b.end);
    entries.forEach((e, i) => out.set(e.v, { start: best[i].start, end: best[i].end, label: best[i].label, conflict: null }));

    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const d = drive(prev.v, cur.v, road);
      if (prev.end + d.minutes - cur.start <= LATE_TOLERANCE_MIN) continue;

      // What would fix it: another slice of this visit, or of the one before,
      // with everything else as it is.
      const fixes: WindowFix[] = [];
      for (const target of [cur, prev]) {
        for (const o of allSlices(target.v)) {
          if (toMin(o.start) === target.start) continue;
          const trial = slots.map((s) => (s.v === target.v ? { ...s, start: toMin(o.start), end: toMin(o.end) } : s));
          if (lateness(trial, road).worst === 0) {
            fixes.push({
              visit: target.v,
              window: o.window,
              text: `${target.v === cur.v ? "Here" : target.v.schoolName ?? "The visit before"}: ${o.label.toLowerCase()} (${o.start}–${o.end})`,
            });
          }
        }
      }
      const w = out.get(cur.v)!;
      out.set(cur.v, {
        ...w,
        conflict: {
          fromSchool: prev.v.schoolName ?? "the visit before",
          leaveAt: toHHMM(prev.end),
          driveMinutes: d.minutes,
          arriveAt: toHHMM(prev.end + d.minutes),
          estimated: d.estimated,
          fixes,
        },
      });
    }
  }
  return out;
}
