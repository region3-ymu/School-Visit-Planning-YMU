/**
 * Verify stored School lat/lng against the official Miami-Dade County
 * schools dataset (data/mdcps-schools.csv). Read-only — never writes to the
 * DB. Fuzzy-matches each active School to a county record by normalized
 * name, then flags coordinate mismatches for manual review.
 *
 * Output: geocoding-verify.csv with one row per active school.
 * A follow-up script (apply-geocoding-fixes.ts) applies a reviewed copy.
 *
 * Run: npx tsx scripts/verify-geocoding.ts
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import stringSimilarity from "string-similarity";
import { PrismaClient } from "@prisma/client";
import { haversineMeters } from "../src/lib/geo";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const COUNTY_CSV_PATH = path.resolve("data/mdcps-schools.csv");
const OUTPUT_CSV_PATH = path.resolve("geocoding-verify.csv");

const MATCH_SCORE_THRESHOLD = 0.5;
const AMBIGUOUS_SCORE_GAP = 0.1;
const MISMATCH_DISTANCE_M = 150;

type CountyRecord = {
  name: string;
  normalizedName: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * Normalize a school name for fuzzy matching:
 *  - strip an "MDCPS |" style prefix
 *  - strip a trailing parenthesized numeric code, e.g. " - (0041)"
 *  - uppercase, strip punctuation
 *  - normalize "K-8" / "K8" / "K 8" (and similarly "K-5", "PK-8", etc.) to "K8" form
 */
function normalizeName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^MDCPS\s*\|\s*/i, "");
  s = s.replace(/\s*-\s*\(\d+\)\s*$/, "");
  s = s.toUpperCase();
  s = s.replace(/[.,'"]/g, "");
  s = s.replace(/\bK[\s-]?(\d+)\b/g, "K$1");
  s = s.replace(/\bPK[\s-]?(\d+)\b/g, "PK$1");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function loadCountySchools(): CountyRecord[] {
  const content = fs.readFileSync(COUNTY_CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, { columns: true, skip_empty_lines: true });

  const records: CountyRecord[] = [];
  for (const row of rows) {
    const name = row.NAME?.trim();
    const lat = Number(row.LAT);
    const lng = Number(row.LON);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const addressParts = [row.ADDRESS?.trim(), row.CITY?.trim(), row.ZIPCODE?.trim()].filter(Boolean);
    records.push({
      name,
      normalizedName: normalizeName(name),
      address: addressParts.join(", "),
      lat,
      lng,
    });
  }
  return records;
}

type MatchResult =
  | { status: "MATCHED"; best: CountyRecord; bestScore: number }
  | { status: "MULTIPLE_CANDIDATES"; best: CountyRecord; bestScore: number; second: CountyRecord; secondScore: number }
  | { status: "NO_MATCH"; best: CountyRecord | null; bestScore: number };

function findBestMatch(schoolName: string, county: CountyRecord[]): MatchResult {
  const normalized = normalizeName(schoolName);
  const targets = county.map((c) => c.normalizedName);
  const { ratings } = stringSimilarity.findBestMatch(normalized, targets);

  const ranked = ratings
    .map((r, i) => ({ record: county[i], score: r.rating }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const runnerUp = ranked[1];

  if (!top || top.score < MATCH_SCORE_THRESHOLD) {
    return { status: "NO_MATCH", best: top?.record ?? null, bestScore: top?.score ?? 0 };
  }

  if (runnerUp && top.score - runnerUp.score < AMBIGUOUS_SCORE_GAP) {
    return {
      status: "MULTIPLE_CANDIDATES",
      best: top.record,
      bestScore: top.score,
      second: runnerUp.record,
      secondScore: runnerUp.score,
    };
  }

  return { status: "MATCHED", best: top.record, bestScore: top.score };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function main() {
  if (!fs.existsSync(COUNTY_CSV_PATH)) {
    console.error(`County dataset not found at ${COUNTY_CSV_PATH}`);
    process.exit(1);
  }

  const county = loadCountySchools();
  console.log(`[VERIFY] Loaded ${county.length} county school records`);

  const schools = await prisma.school.findMany({
    where: { active: true },
    select: { id: true, name: true, lat: true, lng: true },
    orderBy: { name: "asc" },
  });
  console.log(`[VERIFY] Checking ${schools.length} active schools`);

  const rows = [
    "schoolId,name,officialNameMatch,matchScore,storedLat,storedLng,officialLat,officialLng,distanceM,status,candidateAlternative",
  ];

  const counts = { OK: 0, MISMATCH: 0, MULTIPLE_CANDIDATES: 0, NO_MATCH: 0 };

  for (const school of schools) {
    const match = findBestMatch(school.name, county);

    if (match.status === "NO_MATCH") {
      counts.NO_MATCH++;
      // Still surface the best (low-confidence) candidate's coords as a
      // reference — below-threshold doesn't mean useless, e.g. a school
      // whose official name has a long "... Center for X" suffix scores
      // low on pure string similarity despite being the right school.
      rows.push(
        [
          school.id,
          csvEscape(school.name),
          match.best ? csvEscape(match.best.name) : "",
          match.bestScore.toFixed(3),
          school.lat ?? "",
          school.lng ?? "",
          match.best?.lat ?? "",
          match.best?.lng ?? "",
          "",
          "NO_MATCH",
          "",
        ].join(",")
      );
      continue;
    }

    if (match.status === "MULTIPLE_CANDIDATES") {
      counts.MULTIPLE_CANDIDATES++;
      const alt = `${match.second.name} (${match.secondScore.toFixed(3)}) @ ${match.second.address} [${match.second.lat},${match.second.lng}]`;
      rows.push(
        [
          school.id,
          csvEscape(school.name),
          csvEscape(match.best.name),
          match.bestScore.toFixed(3),
          school.lat ?? "",
          school.lng ?? "",
          match.best.lat,
          match.best.lng,
          "",
          "MULTIPLE_CANDIDATES",
          csvEscape(alt),
        ].join(",")
      );
      continue;
    }

    // MATCHED — compute distance and classify OK vs MISMATCH
    const { best, bestScore } = match;
    let distanceM: number | null = null;
    let status: "OK" | "MISMATCH" = "OK";

    if (school.lat != null && school.lng != null) {
      distanceM = haversineMeters(school.lat, school.lng, best.lat, best.lng);
      status = distanceM >= MISMATCH_DISTANCE_M ? "MISMATCH" : "OK";
    } else {
      status = "MISMATCH"; // no stored coords at all
    }

    counts[status]++;
    rows.push(
      [
        school.id,
        csvEscape(school.name),
        csvEscape(best.name),
        bestScore.toFixed(3),
        school.lat ?? "",
        school.lng ?? "",
        best.lat,
        best.lng,
        distanceM != null ? Math.round(distanceM) : "",
        status,
        "",
      ].join(",")
    );
  }

  fs.writeFileSync(OUTPUT_CSV_PATH, rows.join("\n") + "\n");

  console.log(`\n[VERIFY] Wrote ${schools.length} rows to ${OUTPUT_CSV_PATH}`);
  console.log(
    `[VERIFY] OK: ${counts.OK}, MISMATCH: ${counts.MISMATCH}, MULTIPLE_CANDIDATES: ${counts.MULTIPLE_CANDIDATES}, NO_MATCH: ${counts.NO_MATCH}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
