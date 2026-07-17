/**
 * Shared TravelMatrixCache-backed distance/duration lookup.
 * Used by both the Map day-route optimizer (src/lib/routing/optimizeRoute.ts)
 * and the weekly planner (src/modules/visitPlanner/proposeVisits.ts) so a
 * pair of coordinates is only ever sent to the routing API once.
 */
import type { PrismaClient } from "@prisma/client";
import type { IDistanceService, LatLng } from "@/modules/visitPlanner/distance/types";

const COORD_PRECISION = 5;

export function roundCoord(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

export function roundLatLng(p: LatLng): LatLng {
  return { lat: roundCoord(p.lat), lng: roundCoord(p.lng) };
}

type MatrixPair = { i: number; j: number };

/**
 * Returns the full pairwise duration (sec) and distance (m) matrix for `points`.
 * Reads TravelMatrixCache first; any missing pairs are fetched in one batched
 * call to `distanceService` and written back to the cache.
 */
export async function getCachedTravelMatrix(
  points: LatLng[],
  prisma: PrismaClient,
  distanceService: IDistanceService
): Promise<{ durations: number[][]; distances: number[][] }> {
  const n = points.length;
  const durations: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const distances: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const missing: MatrixPair[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const oLat = roundCoord(points[i].lat);
      const oLng = roundCoord(points[i].lng);
      const dLat = roundCoord(points[j].lat);
      const dLng = roundCoord(points[j].lng);

      const cached = await prisma.travelMatrixCache.findUnique({
        where: {
          originLat_originLng_destLat_destLng: {
            originLat: oLat,
            originLng: oLng,
            destLat: dLat,
            destLng: dLng,
          },
        },
      });

      if (cached) {
        durations[i][j] = cached.durationSec;
        distances[i][j] = cached.distanceM;
      } else {
        missing.push({ i, j });
      }
    }
  }

  if (missing.length > 0) {
    const result = await distanceService.getDistanceMatrix(points, points);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dur = result.durations[i]?.[j];
        const dist = result.distances[i]?.[j];
        if (dur == null || dist == null || !Number.isFinite(dur) || !Number.isFinite(dist)) {
          continue;
        }
        durations[i][j] = dur;
        distances[i][j] = dist;

        const oLat = roundCoord(points[i].lat);
        const oLng = roundCoord(points[i].lng);
        const dLat = roundCoord(points[j].lat);
        const dLng = roundCoord(points[j].lng);

        await prisma.travelMatrixCache.upsert({
          where: {
            originLat_originLng_destLat_destLng: {
              originLat: oLat,
              originLng: oLng,
              destLat: dLat,
              destLng: dLng,
            },
          },
          create: {
            originLat: oLat,
            originLng: oLng,
            destLat: dLat,
            destLng: dLng,
            durationSec: dur,
            distanceM: dist,
          },
          update: {
            durationSec: dur,
            distanceM: dist,
          },
        });
      }
    }
  }

  return { durations, distances };
}
