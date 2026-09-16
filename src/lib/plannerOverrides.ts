import type { VisitInfo } from "./types";
import { dayKeyInAppZone } from "./timezone";

/**
 * A visit the user placed by hand.
 *
 * Identified by school, Miami day AND start time: Horace Mann teaches Music
 * Production twice on a B day, so pinning the second slot is a second visit,
 * not a correction of the first.
 */
export type Pin = {
  schoolId: string;
  /** yyyy-MM-dd in Miami. */
  dayKey: string;
  startTime: string;
  endTime: string;
};

export type ResolvedOverrides = {
  pins: Pin[];
  /** "schoolId:yyyy-MM-dd" for each school+day the user took off the plan. */
  skippedDays: Set<string>;
};

export const DEFAULT_PIN_START = "09:00";
export const DEFAULT_PIN_END = "10:00";

/** The school+day an override is about, as the key both halves of this use. */
export function dayScopeOf(schoolId: string, date: Date | string): string {
  return `${schoolId}:${dayKeyInAppZone(new Date(date))}`;
}

/**
 * Reads the user's manual overrides as a set of decisions.
 *
 * The list is a log, not a set: a skip and a pin for the same school and day can
 * both be in it — postponing a visit records a skip on the old day, and
 * deleting a hand-added one records a skip on top of the pin that put it there
 * — so it is read IN ORDER and the last word wins. Read as an unordered pair
 * instead, a deleted visit came straight back on the next recalculation (the
 * pin was still live), or showed on both days at once.
 *
 * A skip carries no start time on purpose: it means the school, that day,
 * whichever class was on it. That is what both "delete this visit" and "move it
 * off this day" mean.
 *
 * Day keys are Miami's. date-fns `format` reads the host's clock, and on Vercel
 * that is UTC — so a 20:00 afterschool class, already tomorrow there, was filed
 * under a different day than the one the user clicked and the skip silently did
 * nothing.
 */
export function resolveOverrides(
  overrides: Partial<VisitInfo>[],
  /** Restricts the result to the week being planned; everything else is stale. */
  withinDayKeys?: Iterable<string>
): ResolvedOverrides {
  const allowed = withinDayKeys ? new Set(withinDayKeys) : null;
  const pinsByKey = new Map<string, Pin>();
  const skippedDays = new Set<string>();

  for (const o of overrides) {
    if (!o.schoolId || !o.date) continue;
    const dayKey = dayKeyInAppZone(new Date(o.date));
    if (allowed && !allowed.has(dayKey)) continue;
    const dayScope = `${o.schoolId}:${dayKey}`;

    if (o.isSkipped) {
      skippedDays.add(dayScope);
      for (const key of [...pinsByKey.keys()]) {
        if (key.startsWith(`${dayScope}:`)) pinsByKey.delete(key);
      }
    } else if (o.isPinned) {
      skippedDays.delete(dayScope);
      const startTime = o.startTime ?? DEFAULT_PIN_START;
      pinsByKey.set(`${dayScope}:${startTime}`, {
        schoolId: o.schoolId,
        dayKey,
        startTime,
        endTime: o.endTime ?? DEFAULT_PIN_END,
      });
    }
  }

  return { pins: [...pinsByKey.values()], skippedDays };
}

/** Whether anything is still pinned for this school on this day. */
export function hasPinOnDay(pins: Pin[], dayScope: string): boolean {
  return pins.some((p) => `${p.schoolId}:${p.dayKey}` === dayScope);
}

/** Splits a "schoolId:yyyy-MM-dd" scope key back into its parts. */
export function splitDayScope(key: string): { schoolId: string; dayKey: string } {
  // The day key is always the last 10 characters, so an id containing a colon
  // could not split this wrongly.
  return { schoolId: key.slice(0, -11), dayKey: key.slice(-10) };
}
