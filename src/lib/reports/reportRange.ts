import {
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfYear, endOfYear,
  subMonths, format,
} from "date-fns";
import type { PrismaClient } from "@prisma/client";

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

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Turns a preset into concrete dates.
 *
 * `quarterKey` ("2026-27|Q2") is only consulted for the "quarter" preset; when
 * it's absent the quarter containing `anchor` is used, and if no quarter covers
 * that date at all the caller gets a clear error rather than a silently empty
 * report.
 */
export async function resolveRange(
  prisma: PrismaClient,
  preset: RangePreset,
  opts: { anchor?: Date; quarterKey?: string | null; start?: string | null; end?: string | null } = {}
): Promise<ResolvedRange> {
  const anchor = opts.anchor ?? new Date();

  switch (preset) {
    case "week": {
      const startDate = startOfWeek(anchor, { weekStartsOn: 1 });
      const endDate = endOfWeek(anchor, { weekStartsOn: 1 });
      return { startDate, endDate, label: `Week of ${format(startDate, "MMM d, yyyy")}` };
    }
    case "month":
      return {
        startDate: startOfMonth(anchor),
        endDate: endOfMonth(anchor),
        label: format(anchor, "MMMM yyyy"),
      };
    case "3months":
      return {
        startDate: startOfDay(subMonths(anchor, 3)),
        endDate: endOfDay(anchor),
        label: `Last 3 months (${format(subMonths(anchor, 3), "MMM d")} – ${format(anchor, "MMM d, yyyy")})`,
      };
    case "6months":
      return {
        startDate: startOfDay(subMonths(anchor, 6)),
        endDate: endOfDay(anchor),
        label: `Last 6 months (${format(subMonths(anchor, 6), "MMM d")} – ${format(anchor, "MMM d, yyyy")})`,
      };
    case "year":
      return {
        startDate: startOfYear(anchor),
        endDate: endOfYear(anchor),
        label: format(anchor, "yyyy"),
      };
    case "custom": {
      if (!opts.start || !opts.end) throw new Error("A custom range needs both a start and an end date");
      const startDate = startOfDay(new Date(opts.start));
      const endDate = endOfDay(new Date(opts.end));
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Invalid custom range dates");
      }
      if (startDate > endDate) throw new Error("The start date must come before the end date");
      return {
        startDate,
        endDate,
        label: `${format(startDate, "MMM d, yyyy")} – ${format(endDate, "MMM d, yyyy")}`,
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
