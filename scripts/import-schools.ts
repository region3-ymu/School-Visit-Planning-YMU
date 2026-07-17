/**
 * CSV school importer — reconcile workflow.
 *
 * Usage:
 *   npm run import-schools -- --region=CENTRAL --file=./data/central.csv
 *   npm run import-schools -- --region=SOUTH --file=./data/south1.csv --file=./data/south2.csv
 *   npm run import-schools -- --region=EAST --file=./data/east.csv --no-deactivate
 *
 * CSV format auto-detected:
 *   - If header col 0 is "School"  → Central format: school name in col 0, all rows imported.
 *   - Otherwise                    → Standard format: active flag in col 0 (TRUE/FALSE), name in col 2.
 *     NOTE: in some source exports this col-0 flag means "this class is running this semester",
 *     not "this school is active" — a school with all its rows FALSE this semester will produce
 *     zero rows and, without --no-deactivate, get deactivated even though it's a real school.
 *
 * Reconcile logic:
 *   - New name      → CREATE with active=true
 *   - Existing name → UPDATE regionId, set active=true (reactivate if was inactive)
 *   - In DB but not in CSV → DEACTIVATE (active=false), unless --no-deactivate is passed
 *
 * --no-deactivate: skip the deactivation step entirely (create/update only).
 *   Use this when the CSV is known to be an incomplete snapshot of the region's
 *   schools (e.g. a semester's class-offering export rather than a full roster).
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { geocodeSchoolByName } from "../src/lib/geocodeSchool";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let region: string | null = null;
  let noDeactivate = false;
  const files: string[] = [];
  for (const arg of args) {
    const regionMatch = arg.match(/^--region=(.+)$/);
    if (regionMatch) { region = regionMatch[1].toUpperCase(); continue; }
    const fileMatch = arg.match(/^--file=(.+)$/);
    if (fileMatch) { files.push(fileMatch[1]); continue; }
    if (arg === "--no-deactivate") { noDeactivate = true; continue; }
  }
  return { region, files, noDeactivate };
}

function cleanName(raw: string): string {
  return raw
    .trim()
    .replace(/[?*]+$/, "")  // trailing ? or *
    .trim();
}

type SchoolRow = { name: string; address?: string };

function extractNamesFromCsv(filePath: string): SchoolRow[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const rows: string[][] = parse(content, { skip_empty_lines: true });
  if (rows.length === 0) return [];

  const header = rows[0];
  const isCentralFormat = header[0]?.trim().toLowerCase() === "school";

  // Detect optional address column (case-insensitive header match).
  const addressColIdx = header.findIndex(
    (h) => h.trim().toLowerCase() === "address"
  );

  const results: SchoolRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    let name: string;
    if (isCentralFormat) {
      name = cleanName(row[0] ?? "");
    } else {
      // Standard format: col 0 = active flag, col 2 = school name
      const active = (row[0] ?? "").trim().toUpperCase();
      if (active !== "TRUE") continue; // skip inactive rows
      name = cleanName(row[2] ?? "");
    }

    if (name.length < 3) continue;

    const address =
      addressColIdx >= 0 ? (row[addressColIdx] ?? "").trim() || undefined : undefined;

    results.push({ name, address });
  }
  return results;
}

async function main() {
  const { region: regionCode, files, noDeactivate } = parseArgs(process.argv);

  if (!regionCode || files.length === 0) {
    console.error("Usage: npm run import-schools -- --region=CODE --file=PATH [--file=PATH2]");
    process.exit(1);
  }

  const regionRecord = await prisma.region.findUnique({ where: { code: regionCode } });
  if (!regionRecord) {
    console.error(`Region "${regionCode}" not found. Run db:seed first.`);
    process.exit(1);
  }

  // Collect all school rows from all files (deduplicated by name, case-insensitive).
  // First occurrence wins for address, so supply the most complete file first.
  const schoolMap = new Map<string, SchoolRow>(); // lowercased name → row
  for (const file of files) {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }
    const rows = extractNamesFromCsv(absPath);
    for (const row of rows) {
      const key = row.name.toLowerCase();
      if (!schoolMap.has(key)) schoolMap.set(key, row);
    }
  }

  const csvSchools = [...schoolMap.values()];
  console.log(`[IMPORT] ${regionCode}: ${csvSchools.length} unique schools from CSV`);

  // Fetch all schools in this region
  const existing = await prisma.school.findMany({
    where: { regionId: regionRecord.id },
    select: { id: true, name: true, address: true, active: true, lat: true, lng: true },
  });

  const existingByLower = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
  const csvNamesLower = new Set(csvSchools.map((r) => r.name.toLowerCase()));

  let created = 0, updated = 0, deactivated = 0, reactivated = 0, geocoded = 0;

  async function ensureGeocoded(
    schoolId: string,
    name: string,
    address: string | null | undefined,
    lat: number | null,
    lng: number | null
  ) {
    if (lat != null && lng != null) return;
    const coords = await geocodeSchoolByName(name, address);
    if (!coords) {
      console.warn(`[GEO] WARN: Could not geocode "${name}"`);
      return;
    }
    await prisma.school.update({
      where: { id: schoolId },
      data: { lat: coords.lat, lng: coords.lng },
    });
    console.log(`[GEO] ${name} -> ${coords.lat}, ${coords.lng}`);
    geocoded++;
  }

  // Create or update
  for (const { name, address } of csvSchools) {
    const key = name.toLowerCase();
    const record = existingByLower.get(key);
    if (!record) {
      const school = await prisma.school.create({
        data: {
          name,
          address: address ?? null,
          regionId: regionRecord.id,
          active: true,
          zipCode: "00000",
          availability: "[]",
        },
      });
      created++;
      await ensureGeocoded(school.id, name, address, school.lat, school.lng);
    } else if (!record.active) {
      await prisma.school.update({
        where: { id: record.id },
        data: { active: true, regionId: regionRecord.id, ...(address ? { address } : {}) },
      });
      reactivated++;
      await ensureGeocoded(record.id, name, address ?? record.address, record.lat, record.lng);
    } else {
      await prisma.school.update({
        where: { id: record.id },
        data: { regionId: regionRecord.id, ...(address ? { address } : {}) },
      });
      updated++;
      await ensureGeocoded(record.id, name, address ?? record.address, record.lat, record.lng);
    }
  }

  // Deactivate schools in DB for this region that aren't in the CSV
  if (noDeactivate) {
    console.log("[IMPORT] --no-deactivate set: skipping deactivation step");
  } else {
    for (const [lower, record] of existingByLower) {
      if (!csvNamesLower.has(lower) && record.active) {
        await prisma.school.update({ where: { id: record.id }, data: { active: false } });
        deactivated++;
      }
    }
  }

  console.log(
    `[IMPORT] Done — Created: ${created}, Updated: ${updated}, Reactivated: ${reactivated}, Deactivated: ${deactivated}, Geocoded: ${geocoded}`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
