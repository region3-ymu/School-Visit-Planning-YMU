/**
 * Seeds the YMU office as a School row flagged `isOffice`.
 *
 * It is a School because mileage, visit chaining and the report all key off
 * Visit.schoolId — giving the office its own model would mean teaching every
 * one of them a second kind of destination. The flag keeps it out of the places
 * that mean *schools*: dashboard counts, the planner, the visit dropdowns, and
 * the roster importers that would otherwise deactivate or delete it.
 *
 * Geocoding note: OpenRouteService resolves this address only to street level
 * ("Northwest 29th Street"), which lands ~113m off. Google returns the building
 * itself, so this seeds Google's coordinates and records that. Re-run after
 * editing OFFICE to move it.
 *
 *   npx tsx scripts/seed-office.ts
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { geocodeAddressGoogle } from "../src/lib/geocodeGoogleFallback";
import { geocodeAddress } from "../src/lib/routing/openRouteClient";
import { haversineMeters } from "../src/lib/geo";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const OFFICE = {
  name: "YMU Office",
  address: "1584 NW 29th St, Miami, FL 33142",
  zipCode: "33142",
};

/** Anything past this from the expected point means the geocoder lost the building. */
const SANITY_RADIUS_M = 400;

async function main() {
  console.log(`Geocoding: ${OFFICE.address}`);

  // Google first here, deliberately: it is the only one of the two that returns
  // the house number for this address.
  const google = await geocodeAddressGoogle(OFFICE.address);
  if (!google) {
    throw new Error(
      "Google returned no rooftop-level match. Check GOOGLE_MAPS_API_KEY, or set the coordinates by hand."
    );
  }
  console.log(`  Google:  ${google.label}`);
  console.log(`           ${google.lat}, ${google.lng}`);

  // Cross-check against ORS. They should broadly agree; a large gap means one of
  // them matched something else entirely and the address deserves a second look.
  try {
    const ors = await geocodeAddress(OFFICE.address);
    const gap = haversineMeters(google.lat, google.lng, ors.lat, ors.lng);
    console.log(`  ORS:     ${ors.label}`);
    console.log(`           ${ors.lat}, ${ors.lng}  (${gap.toFixed(0)}m from Google)`);
    if (gap > SANITY_RADIUS_M) {
      console.log(`  WARNING: the two geocoders disagree by more than ${SANITY_RADIUS_M}m.`);
    }
  } catch (err) {
    console.log(`  ORS:     no match (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
  }

  const existing = await prisma.school.findFirst({ where: { isOffice: true } });

  const data = {
    name: OFFICE.name,
    address: OFFICE.address,
    zipCode: OFFICE.zipCode,
    lat: google.lat,
    lng: google.lng,
    geocodeSource: "google-rooftop",
    isOffice: true,
    active: true,
    // No region: the office serves every region, and leaving it unassigned keeps
    // it out of the per-region school lists for free.
    regionId: null,
  };

  const office = existing
    ? await prisma.school.update({ where: { id: existing.id }, data })
    : await prisma.school.create({ data });

  console.log(`\n${existing ? "Updated" : "Created"} office: ${office.name} (${office.id})`);
  console.log(`  https://www.google.com/maps?q=${office.lat},${office.lng}`);

  const officeCount = await prisma.school.count({ where: { isOffice: true } });
  const schoolCount = await prisma.school.count({ where: { isOffice: false, active: true } });
  console.log(`\nOffices: ${officeCount} | active schools: ${schoolCount}`);
  if (officeCount > 1) {
    console.log("WARNING: more than one office row — the origin picker will show them all.");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
