/**
 * Backfill lat/lng for schools missing coordinates.
 * Run: npm run geocode-schools
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { geocodeSchoolByName, sleep } from "../src/lib/geocodeSchool";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();
const DELAY_MS = 300;

async function main() {
  const schools = await prisma.school.findMany({
    where: {
      OR: [
        { lat: null },
        { lng: null },
        { lat: { lt: 25.14 } },
        { lat: { gt: 26.05 } },
        { lng: { lt: -80.87 } },
        { lng: { gt: -80.12 } },
      ],
    },
    select: { id: true, name: true, address: true, lat: true, lng: true },
    orderBy: { name: "asc" },
  });

  console.log(`[GEOCODE] ${schools.length} schools missing coordinates`);

  let success = 0;
  let failed = 0;
  const failedSchools: string[] = [];

  for (let i = 0; i < schools.length; i++) {
    const school = schools[i];
    const coords = await geocodeSchoolByName(school.name, school.address);

    if (coords) {
      await prisma.school.update({
        where: { id: school.id },
        data: { lat: coords.lat, lng: coords.lng },
      });
      console.log(`[GEO] ${school.name} -> ${coords.lat}, ${coords.lng}`);
      success++;
    } else {
      console.warn(`[GEO] WARN: Could not geocode "${school.name}"`);
      failed++;
      failedSchools.push(school.name);
    }

    if (i < schools.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`[GEOCODE] Done — Success: ${success}, Failed: ${failed}`);
  if (failedSchools.length > 0) {
    console.log("[GEOCODE] Failed schools:");
    for (const name of failedSchools) {
      console.log(`  - ${name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
