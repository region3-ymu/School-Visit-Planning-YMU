/**
 * Phase 2 — applies the decisions confirmed after diagnose-duplicates.ts
 * (Phase 1, read-only) and the reviewed data/approved-geocoding-fixes.csv:
 *
 *   a) Reassign Visit/VisitRule/Teacher/ClassSession from each duplicate's
 *      orphan schoolId to the surviving (keeper) schoolId.
 *   b) Deactivate (active=false) each orphan schoolId — never hard-deleted.
 *   c) Apply approvedLat/approvedLng for every action=UPDATE_COORDS row.
 *   d) action=NO_ACTION / DUPLICATE_NEEDS_DIAGNOSIS rows are left untouched.
 *   e) Prints a final summary.
 *
 * Run: npx tsx scripts/apply-geocoding-fixes.ts
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const APPROVED_CSV_PATH = path.resolve("data/approved-geocoding-fixes.csv");

// Confirmed by user: keep the "cmmkody..." id (real data), deactivate the
// "cmqpox..." id (orphan, 0-or-near-0 related rows) for each exact-duplicate
// pair. Citrus Grove is the one name-mismatched pair: keep the Middle School
// id (37 related rows) over the K-8 id (1 related row) despite the K-8 name
// being the "correct" one per Google Maps — the surviving school row's name
// can be fixed separately later without losing its visit history.
const MERGE_PAIRS: { label: string; keepId: string; dropId: string }[] = [
  { label: "Brownsville Middle School", keepId: "cmmkodyhv000lqp4ytrjo9dqi", dropId: "cmqpox79l0001xt5om1l2xz6u" },
  { label: "Coral Gables Senior High", keepId: "cmmkodyb10008qp4y9fo2wi9x", dropId: "cmqpoxcxk000hxt5oxim3wtf7" },
  { label: "Edison Park K-8", keepId: "cmmkodyjm000oqp4yti074x8y", dropId: "cmqpox8tp0009xt5omidnyvkx" },
  { label: "Georgia Jones-Ayers Middle School", keepId: "cmmkodym9000tqp4y1zx6ixlb", dropId: "cmqpoxcdq000dxt5odym0u5sm" },
  { label: "Horace Mann Middle School", keepId: "cmmkodycq000bqp4y4zu0ujby", dropId: "cmqpox8js0007xt5oo2eh5fgt" },
  { label: "Little River K-8", keepId: "cmmkody8g0003qp4yy6mm4otd", dropId: "cmqpox81y0003xt5ojpnwykgf" },
  { label: "Miami Edison Senior High", keepId: "cmmkodyfb000gqp4y8o0ilfnd", dropId: "cmqpox8aw0005xt5oc34zdacg" },
  { label: "Morningside K-8", keepId: "cmmkodyow000wqp4ymq5q46y2", dropId: "cmqpoxc54000bxt5oq1auha5n" },
  { label: "Young Men's Preparatory Academy", keepId: "cmmkody4t0000qp4ycdlb3aye", dropId: "cmqpoxcmz000fxt5otoynaazb" },
  { label: "Citrus Grove (kept as Middle School)", keepId: "cmmkodyo0000vqp4y1fyjk4vi", dropId: "cmqpcqm5l000pbgxvg47emba4" },
];

// The Citrus Grove K-8 row's approved coords apply to the surviving Middle
// School id instead, per explicit user override of the CSV.
const CITRUS_GROVE_K8_ID = "cmqpcqm5l000pbgxvg47emba4";
const CITRUS_GROVE_KEEP_ID = "cmmkodyo0000vqp4y1fyjk4vi";

type CsvRow = {
  schoolId: string;
  name: string;
  action: string;
  approvedLat: string;
  approvedLng: string;
  notes: string;
};

async function main() {
  const content = fs.readFileSync(APPROVED_CSV_PATH, "utf-8");
  const rows: CsvRow[] = parse(content, { columns: true, skip_empty_lines: true });

  let deactivated = 0;
  let coordsUpdated = 0;
  const relationsReassigned = { visit: 0, visitRule: 0, teacher: 0, classSession: 0 };
  const skipped: { schoolId: string; name: string; action: string }[] = [];

  await prisma.$transaction(async (tx) => {
    // a) + b) merge duplicates
    for (const pair of MERGE_PAIRS) {
      const [v, vr, t, cs] = await Promise.all([
        tx.visit.updateMany({ where: { schoolId: pair.dropId }, data: { schoolId: pair.keepId } }),
        tx.visitRule.updateMany({ where: { schoolId: pair.dropId }, data: { schoolId: pair.keepId } }),
        tx.teacher.updateMany({ where: { schoolId: pair.dropId }, data: { schoolId: pair.keepId } }),
        tx.classSession.updateMany({ where: { schoolId: pair.dropId }, data: { schoolId: pair.keepId } }),
      ]);
      relationsReassigned.visit += v.count;
      relationsReassigned.visitRule += vr.count;
      relationsReassigned.teacher += t.count;
      relationsReassigned.classSession += cs.count;

      await tx.school.update({ where: { id: pair.dropId }, data: { active: false } });
      deactivated++;
      console.log(
        `[MERGE] ${pair.label}: reassigned v=${v.count} vr=${vr.count} t=${t.count} cs=${cs.count} from ${pair.dropId} -> ${pair.keepId}; deactivated ${pair.dropId}`
      );
    }

    // c) apply approved coordinates
    for (const row of rows) {
      if (row.action !== "UPDATE_COORDS") {
        skipped.push({ schoolId: row.schoolId, name: row.name, action: row.action });
        continue;
      }

      const lat = Number(row.approvedLat);
      const lng = Number(row.approvedLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn(`[SKIP] Invalid coords for ${row.name} (${row.schoolId})`);
        continue;
      }

      const targetId = row.schoolId === CITRUS_GROVE_K8_ID ? CITRUS_GROVE_KEEP_ID : row.schoolId;
      await tx.school.update({ where: { id: targetId }, data: { lat, lng } });
      coordsUpdated++;
      console.log(
        `[COORDS] ${row.name}${targetId !== row.schoolId ? ` (redirected ${row.schoolId} -> ${targetId})` : ""} -> ${lat}, ${lng}`
      );
    }
  });

  const totalActive = await prisma.school.count({ where: { active: true } });
  const totalInactive = await prisma.school.count({ where: { active: false } });

  console.log("\n=== SUMMARY ===");
  console.log(`Active schools remaining: ${totalActive}`);
  console.log(`Schools deactivated (merged duplicates): ${deactivated}`);
  console.log(`Coordinates updated: ${coordsUpdated}`);
  console.log(
    `Relations reassigned: Visit=${relationsReassigned.visit}, VisitRule=${relationsReassigned.visitRule}, Teacher=${relationsReassigned.teacher}, ClassSession=${relationsReassigned.classSession}`
  );
  console.log(`Total inactive schools in DB (all-time): ${totalInactive}`);

  if (skipped.length > 0) {
    console.log(`\n=== LEFT UNTOUCHED (${skipped.length} rows, need your review) ===`);
    for (const s of skipped) console.log(`  - ${s.name} (${s.schoolId}) — ${s.action}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
