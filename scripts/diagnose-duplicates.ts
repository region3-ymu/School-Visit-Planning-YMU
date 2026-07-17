/**
 * Diagnose duplicate School rows (same physical school, two schoolIds).
 * Read-only — never writes to the DB. For each pair, counts related rows in
 * every model with a schoolId foreign key (Visit, VisitRule, Teacher,
 * ClassSession) and recommends which ID to keep (the one with more related
 * data — the other is the orphan).
 *
 * Run: npx tsx scripts/diagnose-duplicates.ts
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

// Exact-name duplicate pairs to investigate.
const DUPLICATE_NAMES = [
  "Brownsville Middle School",
  "Coral Gables Senior High",
  "Edison Park K-8",
  "Georgia Jones-Ayers Middle School",
  "Horace Mann Middle School",
  "Little River K-8",
  "Miami Edison Senior High",
  "Morningside K-8",
  "Young Men's Preparatory Academy",
];

// Same physical school, different names in the DB — confirmed by user via Google Maps.
const EXPLICIT_PAIRS: { label: string; schoolIds: string[] }[] = [
  {
    label: "Citrus Grove Middle School / Citrus Grove K-8",
    schoolIds: ["cmmkodyo0000vqp4y1fyjk4vi", "cmqpcqm5l000pbgxvg47emba4"],
  },
];

type RelationCounts = {
  visit: number;
  visitRule: number;
  teacher: number;
  classSession: number;
  total: number;
};

async function countRelations(schoolId: string): Promise<RelationCounts> {
  const [visit, visitRule, teacher, classSession] = await Promise.all([
    prisma.visit.count({ where: { schoolId } }),
    prisma.visitRule.count({ where: { schoolId } }),
    prisma.teacher.count({ where: { schoolId } }),
    prisma.classSession.count({ where: { schoolId } }),
  ]);
  return { visit, visitRule, teacher, classSession, total: visit + visitRule + teacher + classSession };
}

function printPairReport(
  label: string,
  rows: { id: string; name: string; active: boolean; lat: number | null; lng: number | null; counts: RelationCounts }[]
) {
  console.log(`\n=== ${label} ===`);

  if (rows.length < 2) {
    console.log(`  Only ${rows.length} School row(s) found — nothing to diagnose.`);
    for (const r of rows) console.log(`  - ${r.id} (active=${r.active})`);
    return;
  }
  if (rows.length > 2) {
    console.log(`  WARNING: ${rows.length} School rows found (expected 2) — review manually.`);
  }

  for (const r of rows) {
    console.log(
      `  id=${r.id}  active=${r.active}  lat/lng=${r.lat ?? "null"},${r.lng ?? "null"}\n` +
        `      Visit=${r.counts.visit}  VisitRule=${r.counts.visitRule}  Teacher=${r.counts.teacher}  ClassSession=${r.counts.classSession}  TOTAL=${r.counts.total}`
    );
  }

  const sorted = [...rows].sort((a, b) => b.counts.total - a.counts.total);
  const [top, second] = sorted;
  if (top.counts.total === second.counts.total) {
    console.log(`  RECOMMENDATION: TIE (${top.counts.total} each) — needs manual decision.`);
  } else {
    console.log(
      `  RECOMMENDATION: keep ${top.id} (${top.counts.total} related rows) — deactivate/merge ${sorted
        .slice(1)
        .map((r) => r.id)
        .join(", ")} (${second.counts.total} related rows).`
    );
  }
}

async function main() {
  for (const name of DUPLICATE_NAMES) {
    const schools = await prisma.school.findMany({
      where: { name },
      select: { id: true, name: true, active: true, lat: true, lng: true },
    });
    const rows = await Promise.all(
      schools.map(async (s) => ({ ...s, counts: await countRelations(s.id) }))
    );
    printPairReport(name, rows);
  }

  for (const pair of EXPLICIT_PAIRS) {
    const schools = await prisma.school.findMany({
      where: { id: { in: pair.schoolIds } },
      select: { id: true, name: true, active: true, lat: true, lng: true },
    });
    const rows = await Promise.all(
      schools.map(async (s) => ({ ...s, counts: await countRelations(s.id) }))
    );
    printPairReport(pair.label, rows);
  }

  console.log("\n[DIAGNOSE] Done — read-only, nothing was changed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
