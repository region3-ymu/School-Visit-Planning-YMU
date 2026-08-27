/**
 * Route optimization for daily school visits (Phase 2b).
 *
 * ALGORITHM
 * ---------
 * 1. Build a driving-time matrix for [start, stop1..stopN] using OpenRouteService,
 *    with pairwise results cached in TravelMatrixCache (coords rounded to 5 decimals).
 * 2. Decide the visit order. BY DEFAULT that is the order the classes happen —
 *    see classTimeOrder() for why distance is the wrong thing to optimise here.
 *    Pure shortest-drive is still available, and is used automatically when no
 *    stop in the day has a class to catch:
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

function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * Order a day by the classes it is aimed at, not by what happens to be nearest.
 *
 * The TSP below answers "what is the shortest drive", which is the wrong
 * question for this app: a Regional Manager visits a school to see a class, and
 * a class at 9:00 cannot be attended at 14:00 however little fuel that saves.
 * Optimising purely for distance produced routes that were tidy on the map and
 * impossible in practice, visiting the afternoon school first because it was
 * closer to the office.
 *
 * So the class times are the skeleton and they are not negotiable: stops that
 * have one go in chronological order. Distance decides only what it is free to
 * decide — where the stops with NO class (an admin drop-in, the office) slot in,
 * by cheapest insertion into the sequence the classes already fixed.
 *
 * Returns matrix indices (1-based; 0 is the start point), like the TSP does.
 */
export function classTimeOrder(durations: number[][], stops: RouteStopInput[]): number[] {
  const timed: number[] = [];
  const untimed: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    (stops[i].classTime ? timed : untimed).push(i + 1);
  }

  // Two classes at the same time is a genuine conflict the planner flags
  // elsewhere; here the nearer one goes first so the order is at least stable.
  timed.sort((a, b) => {
    const ta = minutesOfDay(stops[a - 1].classTime!);
    const tb = minutesOfDay(stops[b - 1].classTime!);
    if (ta !== tb) return ta - tb;
    return (durations[0]?.[a] ?? 0) - (durations[0]?.[b] ?? 0);
  });

  const order = [...timed];
  for (const idx of untimed) {
    let bestPos = order.length;
    let bestCost = Infinity;
    for (let pos = 0; pos <= order.length; pos++) {
      const prev = pos === 0 ? 0 : order[pos - 1];
      const next = pos === order.length ? null : order[pos];
      // What inserting here adds: the detour in, the detour out, minus the leg
      // it replaces.
      const added =
        (durations[prev]?.[idx] ?? Infinity) +
        (next == null ? 0 : (durations[idx]?.[next] ?? Infinity) - (durations[prev]?.[next] ?? 0));
      if (added < bestCost) {
        bestCost = added;
        bestPos = pos;
      }
    }
    order.splice(bestPos, 0, idx);
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
      classTime: stop.classTime,
      // Said plainly rather than left for the RM to work out by comparing two
      // columns. A day that does not fit is worth knowing about before setting
      // off, not at the second school.
      arrivesLate: stop.classTime ? minutesOfDay(clock) > minutesOfDay(stop.classTime) : undefined,
    });

    prevIdx = idx;
  }

  return legs;
}

export async function optimizeRoute(
  prisma: PrismaClient,
  start: LatLng & { label?: string },
  stops: RouteStopInput[],
  departureTime = "08:00",
  /**
   * "class-time" (the default) keeps the day in the order the classes happen.
   * "shortest-drive" is the old pure-TSP behaviour, for a day of stops with no
   * classes to catch — where distance is the only thing left to optimise.
   */
  strategy: "class-time" | "shortest-drive" = "class-time"
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
  } else if (strategy === "class-time" && roundedStops.some((s) => s.classTime)) {
    matrixOrder = classTimeOrder(durations, roundedStops);
  } else {
    // Either asked for explicitly, or nothing in the day has a class time to
    // order by — then shortest drive is the only sensible answer.
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
