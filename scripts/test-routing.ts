/**
 * Quick smoke test for OpenRouteService integration.
 * Run: npx tsx scripts/test-routing.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { optimizeRoute } from "../src/lib/routing/optimizeRoute";
import { getDrivingPolyline } from "../src/lib/routing/openRouteClient";

async function main() {
  const key = process.env.OPENROUTE_SERVICE_API_KEY;
  if (!key) {
    console.error("OPENROUTE_SERVICE_API_KEY is not set in .env");
    process.exit(1);
  }
  console.log("ORS API key: configured (length", key.length + ")");

  const schools = await prisma.school.findMany({
    where: { active: true, lat: { not: null }, lng: { not: null } },
    take: 3,
    orderBy: { name: "asc" },
  });

  if (schools.length < 2) {
    console.error("Need at least 2 schools with coordinates in the database");
    process.exit(1);
  }

  const start = { lat: schools[0].lat!, lng: schools[0].lng!, label: "Test start" };
  const stops = schools.slice(1).map((s) => ({
    schoolId: s.id,
    schoolName: s.name,
    lat: s.lat!,
    lng: s.lng!,
  }));

  console.log("Optimizing route for:", schools.map((s) => s.name).join(" -> "));

  const route = await optimizeRoute(prisma, start, stops, "08:00");
  console.log(
    "Order:",
    route.stops.map((s) => `${s.order}. ${s.schoolName} (+${Math.round(s.legDurationSec / 60)} min)`).join(", ")
  );
  console.log(
    "Total:",
    Math.round(route.totalDurationSec / 60),
    "min,",
    (route.totalDistanceM / 1609.344).toFixed(1),
    "mi"
  );

  const waypoints = [
    { lat: route.start.lat, lng: route.start.lng },
    ...route.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
  const polyline = await getDrivingPolyline(waypoints);
  console.log("Directions polyline points:", polyline.length);
  console.log("OpenRouteService matrix + directions: OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
