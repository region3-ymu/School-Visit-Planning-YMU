/**
 * Delete class sessions from before the current school year.
 *
 * The calendar sync imported a stretch of last year along with this one. Those
 * sessions are never planned against — the planner only ever asks about a week
 * in the current year — but they are not inert either: they credited teachers
 * with schools they no longer serve, inflated every per-school class count, and
 * were the reason three classes read as "missing a teacher" when they had simply
 * ended in June.
 *
 * Usage:
 *   npx tsx scripts/prune-past-class-sessions.ts            # dry run
 *   npx tsx scripts/prune-past-class-sessions.ts --apply     # delete
 *
 * The cutoff is the first quarter on record rather than a date written here, so
 * it follows the calendar. Nothing else references a ClassSession — visits are
 * their own rows and are untouched — and the sync only ever fetches forward from
 * this week, so these will not come back.
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.slice(2).includes("--apply");

  const firstQuarter = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });
  if (!firstQuarter) throw new Error("No quarters seeded — run scripts/seed-quarters.ts first");
  const cutoff = firstQuarter.startDate;

  console.log(apply ? "APPLY — this deletes rows\n" : "DRY RUN — nothing is deleted\n");
  console.log(`School year starts ${cutoff.toISOString().slice(0, 10)} (${firstQuarter.schoolYear} ${firstQuarter.label})\n`);

  const doomed = await prisma.classSession.findMany({
    where: { startDateTime: { lt: cutoff } },
    select: {
      id: true,
      startDateTime: true,
      school: { select: { name: true } },
      subject: { select: { name: true } },
    },
    orderBy: { startDateTime: "asc" },
  });
  const keeping = await prisma.classSession.count({ where: { startDateTime: { gte: cutoff } } });

  if (doomed.length === 0) {
    console.log("Nothing before the cutoff. Already clean.");
    return;
  }

  console.log(`To delete: ${doomed.length}   Keeping: ${keeping}`);
  console.log(`Range: ${doomed[0].startDateTime.toISOString().slice(0, 10)} → ${doomed[doomed.length - 1].startDateTime.toISOString().slice(0, 10)}\n`);

  const bySchool = new Map<string, number>();
  for (const d of doomed) bySchool.set(d.school.name, (bySchool.get(d.school.name) ?? 0) + 1);
  console.log("By school:");
  for (const [name, n] of [...bySchool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${name.padEnd(38)} ${n}`);
  }
  if (bySchool.size > 12) console.log(`  … and ${bySchool.size - 12} more schools`);

  // A teacher whose every class is last year's would be left with none. Worth
  // naming before the fact rather than discovering it in a list afterwards.
  const teachersAfter = await prisma.teacher.findMany({
    where: { classSessions: { some: { startDateTime: { gte: cutoff } } } },
    select: { id: true },
  });
  const teachersNow = await prisma.teacher.count({ where: { classSessions: { some: {} } } });
  console.log(`\nTeachers holding classes: ${teachersNow} now → ${teachersAfter.length} after`);

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to delete.");
    return;
  }

  const res = await prisma.classSession.deleteMany({ where: { startDateTime: { lt: cutoff } } });
  console.log(`\nDeleted: ${res.count}`);
  console.log(`Class sessions remaining: ${await prisma.classSession.count()}`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
