/**
 * Apply manually-verified lat/lng/address corrections from a reviewed CSV
 * (the output of a human review of validate-school-geocoding.ts's report).
 *
 * Expected columns: schoolId,name,region,verifiedLat,verifiedLng,verifiedAddress,...
 * Extra columns (whichWasRight, notes, etc.) are ignored.
 *
 * Run: npm run apply-geocoding-corrections -- --file="C:\path\to\corrected.csv"
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

function parseArgs(argv: string[]): string | null {
  const arg = argv.slice(2).find((a) => a.startsWith("--file="));
  return arg ? arg.slice("--file=".length) : null;
}

async function main() {
  const filePath = parseArgs(process.argv);
  if (!filePath) {
    console.error('Usage: npm run apply-geocoding-corrections -- --file="path/to/corrected.csv"');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absPath, "utf-8");
  const records: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });

  let updated = 0;
  let skipped = 0;

  for (const row of records) {
    const schoolId = row.schoolId?.trim();
    const lat = Number(row.verifiedLat);
    const lng = Number(row.verifiedLng);
    const address = row.verifiedAddress?.trim() || undefined;

    if (!schoolId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn(`[SKIP] Invalid row: ${JSON.stringify(row)}`);
      skipped++;
      continue;
    }

    const existing = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!existing) {
      console.warn(`[SKIP] No school found with id ${schoolId} (name: ${row.name})`);
      skipped++;
      continue;
    }

    await prisma.school.update({
      where: { id: schoolId },
      data: { lat, lng, ...(address ? { address } : {}) },
    });
    console.log(`[FIXED] ${existing.name} -> ${lat}, ${lng}`);
    updated++;
  }

  console.log(`\n[DONE] Updated: ${updated}, Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
