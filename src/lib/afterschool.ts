import { minutesOfDayInAppZone } from "@/lib/timezone";

/**
 * Is this class an afterschool class?
 *
 * PORTED FROM YMU-A, deliberately unchanged. Its migration 0063 validated this
 * rule against all 18,883 events in YMU's calendar and reproduced YMU's own
 * rulings (2026-08-18) with no misclassification, so SVP matching on a
 * different rule would mean the two apps disagreeing about whose class it is —
 * and the Afterschool Manager reading two different job descriptions depending
 * on which app she opened.
 *
 * WHAT WAS HERE BEFORE was /afterschool/i against the subject name, in three
 * places. It missed almost everything, because the titles do not say
 * "afterschool":
 *
 *   "After School Marching Band (T/Th)"   Carol City, 15:00–17:30, 23 sessions
 *   "After School Rock Ensemble ..."      Coral Gables
 *   "Tutoring"                            Young Men's Preparatory Academy
 *   "Fusion Ensemble - 1"                 Miami Beach Senior High
 *
 * Two words instead of one is enough to defeat it. So Carol City's afterschool
 * marching band was being handed to the NORTH Regional Manager as an ordinary
 * class to visit at 15:00, and the Afterschool Manager — whose entire job it is
 * — could not see it.
 *
 * TWO TIERS, and the reason for them:
 *
 *   strong — the title says it outright, at any hour. The title is authority:
 *     Redland Middle and South Dade run "Marching Band - Afterschool" at
 *     12:00, and a clock rule would throw those away.
 *
 *   weak — ambiguous, and only afterschool if it actually runs late. Carol
 *     City's marching band at 15:00 is afterschool; Homestead Middle's at
 *     07:40 is a regular class. YMU: "Si el marching band es de mañana no es
 *     afterschool entonces."
 *
 * What this deliberately does NOT match, also from YMU's rulings: "asd" and
 * "special" are regular classes and stay with their region's RM, and the bare
 * word "ensemble" is left out on purpose — that is what keeps Citrus Grove's
 * "Jazz Ensamble" (09:45) and Northwestern's "Jazz Band Rhythm Section" out
 * without needing a list of exceptions.
 */

/** Matched as plain lowercase substrings. Two spellings are two entries, not one clever regex. */
export const AFTERSCHOOL_PATTERNS_STRONG = [
  "after school", // 2025-26 spelling, two words
  "afterschool", // 2026-27 spelling, one word
  "aftreschool", // a live typo on real Little River events; the calendars belong to the schools
  "tutoring", // YMU 2026-08-18: tutoring counts as afterschool
  "rock ensemble",
  "fusion", // covers "Fusion Ensemble" and "Sunday Fusion"
] as const;

/** Only afterschool when the class actually starts in the afternoon. */
export const AFTERSCHOOL_PATTERNS_WEAK = ["marching band"] as const;

/**
 * 13:30 rather than a rounder 14:00: Little River's "Tutoring" starts at 13:50
 * and is the earliest class that has to qualify. Compared in Miami time, since
 * "afternoon" is a fact about the school's clock and a UTC comparison would
 * also shift under daylight saving.
 */
const AFTERNOON_CUTOFF_MINUTES = 13 * 60 + 30;

/**
 * The rule itself, against a start expressed as minutes since midnight Miami.
 *
 * Split out because not every caller has a Date: a school's manually-configured
 * availability windows are stored as "HH:mm" strings with no date attached, and
 * they were the fourth place the old regex was written out.
 */
export function isAfterschoolTitle(
  className: string | null | undefined,
  startMinutesOfDay: number | null
): boolean {
  const title = (className ?? "").toLowerCase();
  if (!title) return false;

  if (AFTERSCHOOL_PATTERNS_STRONG.some((p) => title.includes(p))) return true;

  if (AFTERSCHOOL_PATTERNS_WEAK.some((p) => title.includes(p))) {
    // No time to judge by means the weak tier cannot be satisfied — better to
    // leave an ambiguous title with the region's RM than to move a morning
    // class to the Afterschool Manager on a guess.
    if (startMinutesOfDay == null) return false;
    return startMinutesOfDay >= AFTERNOON_CUTOFF_MINUTES;
  }

  return false;
}

/** "HH:mm" -> minutes since midnight, or null if it is not a time. */
export function minutesFromTimeString(time: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((time ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isAfterschoolClass(
  className: string | null | undefined,
  startDateTime: Date | null | undefined
): boolean {
  return isAfterschoolTitle(
    className,
    startDateTime ? minutesOfDayInAppZone(startDateTime) : null
  );
}
