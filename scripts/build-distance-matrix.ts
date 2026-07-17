/**
 * Bulk-precompute the full pairwise TravelMatrixCache for all active,
 * geocoded schools. Run this ONCE after schools are imported and
 * geocoding is finalized (Etapa A). Re-run only when a school is added,
 * deactivated, or its lat/lng is corrected — routing costs are otherwise
 * static, so there is no need to run this on a recurring schedule.
 *
 * Run: npm run build-distance-matrix
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { OpenRouteDistanceService } from "../src/modules/visitPlanner/distance/OpenRouteDistanceService";
import { roundCoord } from "../src/lib/routing/cachedDistanceMatrix";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

// ORS's free-tier /v2/matrix endpoint caps the number of routes (origins x
// destinations) per request — keep blocks conservative so a 3x3 block never
// exceeds that cap, and to stay under the per-minute rate limit.
const BLOCK_SIZE = 40;
const BATCH_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const schools = await prisma.school.findMany({
    where: { active: true, lat: { not: null }, lng: { not: null } },
    select: { id: true, name: true, lat: true, lng: true },
    orderBy: { name: "asc" },
  });

  console.log(`[MATRIX] ${schools.length} geocoded active schools`);
  if (schools.length < 2) {
    console.log("[MATRIX] Need at least 2 schools to build a matrix. Nothing to do.");
    return;
  }

  const points = schools.map((s) => ({ lat: s.lat!, lng: s.lng! }));
  const originBlocks = chunk(points, BLOCK_SIZE);
  const destBlocks = chunk(points, BLOCK_SIZE);
  const distanceService = new OpenRouteDistanceService();

  let pairsWritten = 0;
  let batchesRun = 0;
  const totalBatches = originBlocks.length * destBlocks.length;

  for (let oi = 0; oi < originBlocks.length; oi++) {
    for (let di = 0; di < destBlocks.length; di++) {
      const originBlock = originBlocks[oi];
      const destBlock = destBlocks[di];
      const originOffset = oi * BLOCK_SIZE;
      const destOffset = di * BLOCK_SIZE;

      const result = await distanceService.getDistanceMatrix(originBlock, destBlock);
      batchesRun++;

      for (let i = 0; i < originBlock.length; i++) {
        for (let j = 0; j < destBlock.length; j++) {
          const globalI = originOffset + i;
          const globalJ = destOffset + j;
          if (globalI === globalJ) continue;

          const dur = result.durations[i]?.[j];
          const dist = result.distances[i]?.[j];
          if (dur == null || dist == null || !Number.isFinite(dur) || !Number.isFinite(dist)) {
            continue;
          }

          const oLat = roundCoord(originBlock[i].lat);
          const oLng = roundCoord(originBlock[i].lng);
          const dLat = roundCoord(destBlock[j].lat);
          const dLng = roundCoord(destBlock[j].lng);

          await prisma.travelMatrixCache.upsert({
            where: {
              originLat_originLng_destLat_destLng: {
                originLat: oLat,
                originLng: oLng,
                destLat: dLat,
                destLng: dLng,
              },
            },
            create: { originLat: oLat, originLng: oLng, destLat: dLat, destLng: dLng, durationSec: dur, distanceM: dist },
            update: { durationSec: dur, distanceM: dist },
          });
          pairsWritten++;
        }
      }

      console.log(`[MATRIX] Batch ${batchesRun}/${totalBatches} done — ${pairsWritten} pairs cached so far`);

      if (batchesRun < totalBatches) {
        await sleep(BATCH_DELAY_MS);
      }
    }
  }

  console.log(`[MATRIX] Done — ${pairsWritten} pairs cached across ${schools.length} schools`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
