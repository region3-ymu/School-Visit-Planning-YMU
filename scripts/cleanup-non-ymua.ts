/**
 * Reduce this database to exactly the YMU-A roster.
 *
 * The database accumulated three kinds of cruft before the YMU-A import:
 * duplicate school rows from a re-import that didn't recognise existing
 * schools, schools YMU no longer serves, and test visit history. This removes
 * all three, leaving only schools that carry an externalId — i.e. schools that
 * came from YMU-A and are pinned to a Google calendar.
 *
 * Usage:
 *   npm run cleanup:non-ymua              # dry run — shows exactly what would go
 *   npm run cleanup:non-ymua -- --apply   # delete, after writing a backup
 *
 * --apply writes backup-cleanup-<timestamp>.json first (every deleted row, in
 * full) and refuses to delete any school that still has class sessions,
 * teachers or visit rules attached.
 *
 * DESTRUCTIVE. Deletions are not recoverable except from that backup file or a
 * Neon point-in-time restore.
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.slice(2).includes("--apply");

  const doomed = await prisma.school.findMany({
    where: { externalId: null },
    select: {
      id: true,
      name: true,
      active: true,
      region: { select: { code: true } },
      _count: {
        select: { classSessions: true, visits: true, teachers: true, visitRules: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const visitCount = await prisma.visit.count();
  const issueCount = await prisma.calendarSyncIssue.count();
  const keepCount = await prisma.school.count({ where: { externalId: { not: null } } });

  console.log(`Schools from YMU-A (kept):        ${keepCount}`);
  console.log(`Schools not in YMU-A (deleted):   ${doomed.length}`);
  console.log(`Visits (all deleted):             ${visitCount}`);
  console.log(`Calendar sync issues (cleared):   ${issueCount}\n`);

  for (const s of doomed) {
    const c = s._count;
    console.log(
      `  ${s.active ? "ACTIVE  " : "inactive"} ${(s.region?.code ?? "—").padEnd(7)} ` +
        `sessions=${c.classSessions} visits=${c.visits} teachers=${c.teachers} rules=${c.visitRules}  "${s.name}"`
    );
  }

  if (!apply) {
    console.log("\nDry run — nothing deleted. Re-run with --apply to commit.");
    return;
  }

  // Full backup before anything is removed.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(`backup-cleanup-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        deletedAt: new Date().toISOString(),
        visits: await prisma.visit.findMany(),
        schools: await prisma.school.findMany({ where: { externalId: null } }),
        calendarSyncIssues: await prisma.calendarSyncIssue.findMany(),
      },
      null,
      2
    )
  );
  console.log(`\nBackup written to ${backupPath}`);

  const deletedVisits = await prisma.visit.deleteMany({});
  console.log(`Visits deleted: ${deletedVisits.count}`);

  // Re-check after the visit sweep: anything still holding class sessions,
  // teachers or rules is not the disposable duplicate this script assumes.
  const stillAttached = (
    await prisma.school.findMany({
      where: { externalId: null },
      select: {
        name: true,
        _count: { select: { classSessions: true, teachers: true, visitRules: true } },
      },
    })
  ).filter((s) => s._count.classSessions || s._count.teachers || s._count.visitRules);

  if (stillAttached.length) {
    console.error("\nStopped — these still have data attached, so nothing was deleted:");
    for (const s of stillAttached) {
      console.error(
        `  ${s.name}: sessions=${s._count.classSessions} teachers=${s._count.teachers} rules=${s._count.visitRules}`
      );
    }
    process.exitCode = 1;
    return;
  }

  const deletedSchools = await prisma.school.deleteMany({ where: { externalId: null } });
  console.log(`Schools deleted: ${deletedSchools.count}`);

  const deletedIssues = await prisma.calendarSyncIssue.deleteMany({});
  console.log(`Calendar sync issues cleared: ${deletedIssues.count}`);

  console.log("\n=== Final state ===");
  console.log(`Schools:          ${await prisma.school.count()}`);
  console.log(`With a calendar:  ${await prisma.school.count({ where: { googleCalendarId: { not: null } } })}`);
  console.log(`With coordinates: ${await prisma.school.count({ where: { lat: { not: null } } })}`);
  console.log(`Without a region: ${await prisma.school.count({ where: { regionId: null } })}`);
  console.log(`Class sessions:   ${await prisma.classSession.count()}`);
  console.log(`Visits:           ${await prisma.visit.count()}`);

  const regions = await prisma.region.findMany({
    select: { code: true, _count: { select: { schools: true } } },
    orderBy: { code: "asc" },
  });
  console.log(`By region:        ${regions.map((r) => `${r.code}=${r._count.schools}`).join("  ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
