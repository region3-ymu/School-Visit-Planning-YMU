/**
 * Every school, RM and office in this app is in Miami-Dade, so wall-clock time
 * means Eastern regardless of where the code runs.
 *
 * That distinction is not academic: Vercel runs its functions in UTC, so
 * date-fns `format` on the server rendered an 08:48 class as "12:48". These
 * helpers name the zone rather than inheriting the host's, so a schedule reads
 * the same on a laptop in Miami and in a serverless function anywhere.
 */
export const APP_TIME_ZONE = "America/New_York";

function partsInZone(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  // Intl renders midnight as hour "24" in some ICU versions under hour12:false.
  if (out.hour === "24") out.hour = "00";
  return out;
}

/** Wall-clock time in Miami, as "HH:mm". */
export function formatTimeInAppZone(date: Date): string {
  const p = partsInZone(date);
  return `${p.hour}:${p.minute}`;
}

/** Minutes past midnight in Miami — for comparing against a work window. */
export function minutesOfDayInAppZone(date: Date): number {
  const p = partsInZone(date);
  return +p.hour * 60 + +p.minute;
}

/**
 * The calendar day in Miami, as "yyyy-MM-dd".
 *
 * Used to bucket class sessions by day. A UTC-based key agrees with this one
 * for any class before 8pm Eastern, which is every school class — but only by
 * luck, and the luck runs out on an evening event.
 */
export function dayKeyInAppZone(date: Date): string {
  const p = partsInZone(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Milliseconds the app's zone is ahead of UTC at a given instant (negative here). */
function zoneOffsetMs(date: Date): number {
  const p = partsInZone(date);
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, date.getUTCSeconds());
  return asIfUtc - date.getTime();
}

/**
 * The instant at which a Miami calendar day begins.
 *
 * Two passes because the offset is itself a function of the instant: on a
 * spring-forward date the naive guess lands an hour off, and the second pass
 * settles it.
 */
export function zonedDayStart(dayKey: string): Date {
  const guess = new Date(`${dayKey}T00:00:00.000Z`);
  const first = new Date(guess.getTime() - zoneOffsetMs(guess));
  return new Date(guess.getTime() - zoneOffsetMs(first));
}

/** Calendar arithmetic on a "yyyy-MM-dd" key — no zone involved. */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week containing `dayKey`. */
export function mondayOfDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  return addDaysToDayKey(dayKey, -((d.getUTCDay() + 6) % 7));
}

/**
 * Reads whatever the client sent for "which week" as a Miami calendar day.
 *
 * A bare "yyyy-MM-dd" is already zone-free and is taken as-is. A full ISO
 * instant is converted, which is what stops 9pm Miami — already tomorrow in
 * UTC — from selecting next week.
 */
export function toAppZoneDayKey(input: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : dayKeyInAppZone(new Date(input));
}
