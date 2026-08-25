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
