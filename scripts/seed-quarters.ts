/**
 * Seeds the 2026-27 grading quarters.
 *
 * The previous rows ran Jul 2026 – Mar 2027, which put Q1 in summer and left
 * April through June uncovered — a mileage report asked for "this quarter" in
 * May had no quarter to resolve against and errored out.
 *
 * These follow the real M-DCPS calendar: instruction opens Thursday Aug 13 2026
 * and closes Friday Jun 4 2027, with the winter and spring breaks falling in the
 * gaps between quarters. Each quarter is roughly nine weeks; they are not
 * identical because the breaks don't divide evenly.
 *
 * Safe to re-run — it upserts on (schoolYear, label). Edit QUARTERS and run
 * again if the district calendar differs:
 *   npx tsx scripts/seed-quarters.ts
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const SCHOOL_YEAR = "2026-27";

const QUARTERS = [
  { label: "Q1", start: "2026-08-13", end: "2026-10-16" },
  { label: "Q2", start: "2026-10-19", end: "2026-12-18" },
  { label: "Q3", start: "2027-01-05", end: "2027-03-19" },
  { label: "Q4", start: "2027-03-29", end: "2027-06-04" },
];

/** Parsed as local midnight / end-of-day so a quarter covers its whole last day. */
function startOfDayUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function endOfDayUtc(iso: string): Date {
  return new Date(`${iso}T23:59:59.999Z`);
}

async function main() {
  const existing = await prisma.quarter.findMany({ orderBy: [{ schoolYear: "asc" }, { label: "asc" }] });
  console.log(`Existing quarters: ${existing.length}`);
  for (const q of existing) {
    console.log(`  ${q.schoolYear} ${q.label}: ${q.startDate.toISOString().slice(0, 10)} -> ${q.endDate.toISOString().slice(0, 10)}`);
  }

  console.log(`\nSeeding ${SCHOOL_YEAR}:`);
  for (const q of QUARTERS) {
    const startDate = startOfDayUtc(q.start);
    const endDate = endOfDayUtc(q.end);
    await prisma.quarter.upsert({
      where: { schoolYear_label: { schoolYear: SCHOOL_YEAR, label: q.label } },
      create: { schoolYear: SCHOOL_YEAR, label: q.label, startDate, endDate },
      update: { startDate, endDate },
    });
    const weeks = ((endDate.getTime() - startDate.getTime()) / (7 * 24 * 3600 * 1000)).toFixed(1);
    console.log(`  ${q.label}: ${q.start} -> ${q.end}  (${weeks} weeks)`);
  }

  // Anything left over from an earlier seeding of the same year would silently
  // overlap these ranges and double-count visits, so flag it loudly.
  const stale = await prisma.quarter.findMany({
    where: { schoolYear: SCHOOL_YEAR, label: { notIn: QUARTERS.map((q) => q.label) } },
  });
  if (stale.length > 0) {
    console.log(`\nWARNING: ${stale.length} other ${SCHOOL_YEAR} quarter(s) remain and may overlap:`);
    for (const q of stale) console.log(`  ${q.label}: ${q.startDate.toISOString().slice(0, 10)} -> ${q.endDate.toISOString().slice(0, 10)}`);
  }

  const today = new Date();
  const covering = await prisma.quarter.findFirst({
    where: { startDate: { lte: today }, endDate: { gte: today } },
  });
  console.log(
    `\nToday (${today.toISOString().slice(0, 10)}) falls in: ${covering ? `${covering.schoolYear} ${covering.label}` : "no quarter"}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
