/**
 * Route optimization for daily school visits (Phase 2b).
 *
 * ALGORITHM
 * ---------
 * 1. Build a driving-time matrix for [start, stop1..stopN] using OpenRouteService,
 *    with pairwise results cached in TravelMatrixCache (coords rounded to 5 decimals).
 * 2. Solve the Traveling Salesman Problem approximately:
 *    a) Nearest-neighbor heuristic starting from the depot (index 0 = start).
 *    b) 2-opt local search: repeatedly reverse segments until no improvement.
 *    Good enough for <=10 stops; typical runtime <1 ms after matrix is loaded.
 * 3. Convert the visit order into per-leg and cumulative time/distance, plus
 *    estimated arrival times from a configurable departure clock time.
 *
 * MANUAL REORDER
 * --------------
 * computeRouteForOrder() skips TSP and recomputes legs for a user-supplied order.
 */

import type { PrismaClient } from "@prisma/client";
import { OpenRouteDistanceService } from "@/modules/visitPlanner/distance/OpenRouteDistanceService";
import { getCachedTravelMatrix, roundCoord, roundLatLng } from "@/lib/routing/cachedDistanceMatrix";
import type { LatLng, OptimizedRouteResult, RouteLeg, RouteStopInput } from "./types";

export { roundCoord, roundLatLng };

function nearestNeighborOrder(durations: number[][], stopCount: number): number[] {
  const visited = new Set<number>([0]);
  const order: number[] = [];
  let current = 0;

  while (order.length < stopCount) {
    let best = -1;
    let bestDur = Infinity;
    for (let j = 1; j <= stopCount; j++) {
      if (visited.has(j)) continue;
      const d = durations[current]?.[j] ?? Infinity;
      if (d < bestDur) {
        bestDur = d;
        best = j;
      }
    }
    if (best < 0) break;
    visited.add(best);
    order.push(best);
    current = best;
  }

  return order;
}

function routeCost(order: number[], durations: number[][]): number {
  let total = 0;
  let prev = 0;
  for (const idx of order) {
    total += durations[prev]?.[idx] ?? Infinity;
    prev = idx;
  }
  return total;
}

function twoOptImprove(initial: number[], durations: number[][]): number[] {
  if (initial.length < 2) return initial;

  let order = [...initial];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const newOrder = [
          ...order.slice(0, i),
          ...order.slice(i, k + 1).reverse(),
          ...order.slice(k + 1),
        ];
        if (routeCost(newOrder, durations) < routeCost(order, durations)) {
          order = newOrder;
          improved = true;
        }
      }
    }
  }

  return order;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + (m ?? 0) + Math.round(minutes);
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function buildLegs(
  matrixIndices: number[],
  stops: RouteStopInput[],
  durations: number[][],
  distances: number[][],
  departureTime: string
): RouteLeg[] {
  const legs: RouteLeg[] = [];
  let prevIdx = 0;
  let cumulativeSec = 0;
  let cumulativeM = 0;
  let clock = departureTime;

  for (let order = 0; order < matrixIndices.length; order++) {
    const idx = matrixIndices[order];
    const stop = stops[idx - 1];
    const legDur = durations[prevIdx]?.[idx] ?? 0;
    const legDist = distances[prevIdx]?.[idx] ?? 0;
    cumulativeSec += legDur;
    cumulativeM += legDist;
    clock = addMinutesToTime(clock, legDur / 60);

    legs.push({
      schoolId: stop.schoolId,
      schoolName: stop.schoolName,
      lat: stop.lat,
      lng: stop.lng,
      order: order + 1,
      legDurationSec: legDur,
      legDistanceM: legDist,
      cumulativeDurationSec: cumulativeSec,
      cumulativeDistanceM: cumulativeM,
      arrivalTime: clock,
    });

    prevIdx = idx;
  }

  return legs;
}

export async function optimizeRoute(
  prisma: PrismaClient,
  start: LatLng & { label?: string },
  stops: RouteStopInput[],
  departureTime = "08:00"
): Promise<OptimizedRouteResult> {
  if (stops.length === 0) {
    return {
      stops: [],
      totalDurationSec: 0,
      totalDistanceM: 0,
      start: roundLatLng(start),
    };
  }

  const distanceService = new OpenRouteDistanceService();
  const roundedStart = roundLatLng(start);
  const roundedStops = stops.map((s) => ({
    ...s,
    lat: roundCoord(s.lat),
    lng: roundCoord(s.lng),
  }));

  const points: LatLng[] = [
    roundedStart,
    ...roundedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];

  const { durations, distances } = await getCachedTravelMatrix(points, prisma, distanceService);

  let matrixOrder: number[];
  if (stops.length === 1) {
    matrixOrder = [1];
  } else {
    const nn = nearestNeighborOrder(durations, stops.length);
    matrixOrder = twoOptImprove(nn, durations);
  }

  const legs = buildLegs(matrixOrder, roundedStops, durations, distances, departureTime);

  return {
    stops: legs,
    totalDurationSec: routeCost(matrixOrder, durations),
    totalDistanceM: legs[legs.length - 1]?.cumulativeDistanceM ?? 0,
    start: { ...roundedStart, label: start.label },
  };
}

export async function computeRouteForOrder(
  prisma: PrismaClient,
  start: LatLng & { label?: string },
  orderedStops: RouteStopInput[],
  departureTime = "08:00"
): Promise<OptimizedRouteResult> {
  if (orderedStops.length === 0) {
    return {
      stops: [],
      totalDurationSec: 0,
      totalDistanceM: 0,
      start: roundLatLng(start),
    };
  }

  const distanceService = new OpenRouteDistanceService();
  const roundedStart = roundLatLng(start);
  const roundedStops = orderedStops.map((s) => ({
    ...s,
    lat: roundCoord(s.lat),
    lng: roundCoord(s.lng),
  }));

  const points: LatLng[] = [
    roundedStart,
    ...roundedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];

  const { durations, distances } = await getCachedTravelMatrix(points, prisma, distanceService);

  const stopIndexById = new Map(roundedStops.map((s, i) => [s.schoolId, i + 1]));
  const matrixOrder = orderedStops.map((s) => stopIndexById.get(s.schoolId)!);

  const legs = buildLegs(matrixOrder, roundedStops, durations, distances, departureTime);

  return {
    stops: legs,
    totalDurationSec: routeCost(matrixOrder, durations),
    totalDistanceM: legs[legs.length - 1]?.cumulativeDistanceM ?? 0,
    start: { ...roundedStart, label: start.label },
  };
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

export function hashSchoolId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function displayCoords(
  lat: number,
  lng: number,
  schoolId: string,
  allCoords: { lat: number; lng: number; schoolId: string }[]
): [number, number] {
  const duplicates = allCoords.filter(
    (c) => roundCoord(c.lat) === roundCoord(lat) && roundCoord(c.lng) === roundCoord(lng)
  );
  if (duplicates.length <= 1) return [lat, lng];

  const index = duplicates.findIndex((c) => c.schoolId === schoolId);
  const h = hashSchoolId(schoolId);
  const angle = ((Math.abs(h) % 360) + index * 45) * (Math.PI / 180);
  const offset = 0.0008;
  return [lat + Math.sin(angle) * offset, lng + Math.cos(angle) * offset];
}
