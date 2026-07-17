/**
 * Validate existing lat/lng against a fresh geocode lookup.
 * Never overwrites — only reports schools whose stored coordinates disagree
 * with the canonical geocode result by more than DISTANCE_THRESHOLD_M, or
 * that fall outside the Miami-Dade bounding box.
 *
 * Run: npm run validate-geocoding
 *      npm run validate-geocoding -- --csv=geocoding-review.csv
 */
import dotenv from "dotenv";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { geocodeSchoolByName, isInMiamiBounds, sleep } from "../src/lib/geocodeSchool";
import { haversineMeters } from "../src/lib/geo";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();
const DELAY_MS = 300;
const DISTANCE_THRESHOLD_M = 400;

function parseCsvArg(argv: string[]): string | null {
  const arg = argv.slice(2).find((a) => a.startsWith("--csv="));
  return arg ? arg.slice("--csv=".length) : null;
}

async function main() {
  const csvPath = parseCsvArg(process.argv);

  const schools = await prisma.school.findMany({
    where: { active: true, lat: { not: null }, lng: { not: null } },
    select: { id: true, name: true, address: true, lat: true, lng: true, region: { select: { code: true } } },
    orderBy: { name: "asc" },
  });

  console.log(`[VALIDATE] Checking ${schools.length} geocoded schools`);

  type Flag = {
    schoolId: string;
    name: string;
    region: string;
    storedLat: number;
    storedLng: number;
    canonicalLat: number | null;
    canonicalLng: number | null;
    distanceM: number | null;
    reason: string;
  };

  const flagged: Flag[] = [];
  let checked = 0;
  let skippedNoResult = 0;

  for (let i = 0; i < schools.length; i++) {
    const school = schools[i];
    const storedLat = school.lat!;
    const storedLng = school.lng!;
    let reason: string | null = null;
    let canonicalLat: number | null = null;
    let canonicalLng: number | null = null;
    let distanceM: number | null = null;

    if (!isInMiamiBounds(storedLat, storedLng)) {
      reason = "OUTSIDE_MIAMI_BOUNDS";
    }

    const canonical = await geocodeSchoolByName(school.name, school.address);
    checked++;

    if (!canonical) {
      skippedNoResult++;
    } else {
      canonicalLat = canonical.lat;
      canonicalLng = canonical.lng;
      distanceM = haversineMeters(storedLat, storedLng, canonical.lat, canonical.lng);
      if (distanceM > DISTANCE_THRESHOLD_M) {
        reason = reason ?? "MISMATCH";
      }
    }

    if (reason) {
      flagged.push({
        schoolId: school.id,
        name: school.name,
        region: school.region?.code ?? "",
        storedLat,
        storedLng,
        canonicalLat,
        canonicalLng,
        distanceM,
        reason,
      });
    }

    if (i < schools.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`[VALIDATE] Checked: ${checked}, no geocode result: ${skippedNoResult}, flagged: ${flagged.length}`);

  if (flagged.length > 0) {
    console.log("\n[VALIDATE] Flagged for manual review (not modified):\n");
    for (const f of flagged) {
      const distText = f.distanceM != null ? `${Math.round(f.distanceM)}m` : "n/a";
      console.log(
        `  - ${f.name} (${f.region}) [${f.reason}]\n` +
          `      stored:    ${f.storedLat}, ${f.storedLng}\n` +
          `      canonical: ${f.canonicalLat ?? "?"}, ${f.canonicalLng ?? "?"}\n` +
          `      distance:  ${distText}\n`
      );
    }
  } else {
    console.log("[VALIDATE] No mismatches found.");
  }

  if (csvPath) {
    const rows = ["schoolId,name,region,storedLat,storedLng,canonicalLat,canonicalLng,distanceM,reason"];
    for (const f of flagged) {
      rows.push(
        [
          f.schoolId,
          JSON.stringify(f.name),
          f.region,
          f.storedLat,
          f.storedLng,
          f.canonicalLat ?? "",
          f.canonicalLng ?? "",
          f.distanceM != null ? Math.round(f.distanceM) : "",
          f.reason,
        ].join(",")
      );
    }
    fs.writeFileSync(csvPath, rows.join("\n") + "\n");
    console.log(`\n[VALIDATE] Wrote ${flagged.length} flagged rows to ${csvPath}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
