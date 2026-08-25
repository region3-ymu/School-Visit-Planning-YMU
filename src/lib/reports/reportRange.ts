import { format } from "date-fns";
import type { PrismaClient } from "@prisma/client";
import {
  addDaysToDayKey,
  dayKeyInAppZone,
  mondayOfDayKey,
  toAppZoneDayKey,
  zonedDayStart,
} from "@/lib/timezone";

/**
 * The windows a mileage report can be asked for.
 *
 * "quarter" is YMU's own 9-week grading period and comes from the Quarter table,
 * so it can't be derived from arithmetic like the others — it's resolved against
 * the database. Everything else is a plain calendar range anchored on `anchor`.
 */
export type RangePreset =
  | "week"
  | "month"
  | "quarter"
  | "3months"
  | "6months"
  | "year"
  | "custom";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "Quarter (9 weeks)" },
  { value: "3months", label: "Last 3 months" },
  { value: "6months", label: "Last 6 months" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

export type ResolvedRange = { startDate: Date; endDate: Date; label: string };

/**
 * Report periods are built from Miami calendar dates, never from the host's.
 *
 * Wrapping date-fns wasn't enough: startOfMonth(anchor) on a UTC server returns
 * the 1st at 00:00 UTC, which is 8pm on the 31st in Miami — so "August" started
 * in July. All the arithmetic below is done on "yyyy-MM-dd" keys, which carry no
 * zone at all, and only converted to instants at the end.
 */
function keyParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function makeKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addMonthsToKey(key: string, months: number): string {
  const { y, m, d } = keyParts(key);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  // Clamp for short months: 31 Mar minus one month is 28/29 Feb, not 3 Mar.
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return makeKey(ny, nm, Math.min(d, lastDay));
}

function lastDayOfMonthKey(key: string): string {
  const { y, m } = keyParts(key);
  return makeKey(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
}

/** First instant of a Miami calendar day. */
function dayStart(key: string): Date {
  return zonedDayStart(key);
}

/** Last instant of a Miami calendar day. */
function dayEnd(key: string): Date {
  return new Date(zonedDayStart(addDaysToDayKey(key, 1)).getTime() - 1);
}

/** Labels are built from the key so they can't drift a day either. */
function labelDate(key: string, pattern: string): string {
  return format(zonedDayStart(key), pattern);
}

export async function resolveRange(
  prisma: PrismaClient,
  preset: RangePreset,
  opts: { anchor?: Date; quarterKey?: string | null; start?: string | null; end?: string | null } = {}
): Promise<ResolvedRange> {
  const anchor = opts.anchor ?? new Date();
  const anchorKey = dayKeyInAppZone(anchor);

  switch (preset) {
    case "week": {
      const startKey = mondayOfDayKey(anchorKey);
      const endKey = addDaysToDayKey(startKey, 6);
      return {
        startDate: dayStart(startKey),
        endDate: dayEnd(endKey),
        label: `Week of ${labelDate(startKey, "MMM d, yyyy")}`,
      };
    }
    case "month": {
      const { y, m } = keyParts(anchorKey);
      const startKey = makeKey(y, m, 1);
      return {
        startDate: dayStart(startKey),
        endDate: dayEnd(lastDayOfMonthKey(anchorKey)),
        label: labelDate(startKey, "MMMM yyyy"),
      };
    }
    case "3months":
    case "6months": {
      const months = preset === "3months" ? 3 : 6;
      const startKey = addMonthsToKey(anchorKey, -months);
      return {
        startDate: dayStart(startKey),
        endDate: dayEnd(anchorKey),
        label: `Last ${months} months (${labelDate(startKey, "MMM d")} – ${labelDate(anchorKey, "MMM d, yyyy")})`,
      };
    }
    case "year": {
      const { y } = keyParts(anchorKey);
      return {
        startDate: dayStart(makeKey(y, 1, 1)),
        endDate: dayEnd(makeKey(y, 12, 31)),
        label: String(y),
      };
    }
    case "custom": {
      if (!opts.start || !opts.end) throw new Error("A custom range needs both a start and an end date");
      const startKey = toAppZoneDayKey(opts.start);
      const endKey = toAppZoneDayKey(opts.end);
      const startDate = dayStart(startKey);
      const endDate = dayEnd(endKey);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Invalid custom range dates");
      }
      if (startDate > endDate) throw new Error("The start date must come before the end date");
      return {
        startDate,
        endDate,
        label: `${labelDate(startKey, "MMM d, yyyy")} – ${labelDate(endKey, "MMM d, yyyy")}`,
      };
    }
    case "quarter": {
      if (opts.quarterKey) {
        const [schoolYear, label] = opts.quarterKey.split("|");
        const q = await prisma.quarter.findUnique({
          where: { schoolYear_label: { schoolYear, label } },
        });
        if (!q) throw new Error(`No quarter found for ${schoolYear} ${label}`);
        return { startDate: q.startDate, endDate: q.endDate, label: `${q.schoolYear} ${q.label}` };
      }
      const containing = await prisma.quarter.findFirst({
        where: { startDate: { lte: anchor }, endDate: { gte: anchor } },
      });
      if (!containing) {
        throw new Error(
          `No quarter covers ${format(anchor, "MMM d, yyyy")}. Pick a quarter explicitly or use another range.`
        );
      }
      return {
        startDate: containing.startDate,
        endDate: containing.endDate,
        label: `${containing.schoolYear} ${containing.label}`,
      };
    }
  }
}
