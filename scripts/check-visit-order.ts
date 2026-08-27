/**
 * Checks that a day's route follows the classes, not the map.
 *
 *   npm run check:order
 *
 * The case that matters is the adversarial one: the stop NEAREST the starting
 * point is the LAST class of the day. A distance optimiser goes there first and
 * produces a route that is tidy on the map and impossible in practice — which
 * is exactly what this app used to do (YMU 2026-08-27: "me hace la ruta por
 * cercania NO por orden de hora de clases").
 *
 * No database and no routing API: the whole point is the ordering rule, so the
 * travel-time matrix is handwritten to make proximity and chronology disagree.
 */
import { classTimeOrder } from "../src/lib/routing/optimizeRoute";
import type { RouteStopInput } from "../src/lib/routing/types";

const stops: RouteStopInput[] = [
  { schoolId: "A", schoolName: "A", lat: 0, lng: 0, classTime: "09:00" },
  { schoolId: "B", schoolName: "B", lat: 0, lng: 0, classTime: "11:00" },
  { schoolId: "C", schoolName: "C", lat: 0, lng: 0, classTime: "13:00" },
  // No class to catch: free to be slotted wherever it costs least driving.
  { schoolId: "D", schoolName: "D", lat: 0, lng: 0 },
];

// durations[i][j] in minutes; index 0 is the start point. C is 5 minutes away,
// A is 60 — so nearest-first would run the day backwards. D sits next to A.
const FAR = 9999;
const durations = [
  [0, 60, 30, 5, FAR],
  [60, 0, 20, 40, 10],
  [30, 20, 0, 15, 50],
  [5, 40, 15, 0, 60],
  [FAR, 10, 50, 60, 0],
];

const order = classTimeOrder(durations, stops);
const names = order.map((i) => stops[i - 1].schoolId);
const timed = order.map((i) => stops[i - 1].classTime).filter(Boolean) as string[];

const checks: [string, boolean][] = [
  ["classes run in chronological order", JSON.stringify(timed) === JSON.stringify([...timed].sort())],
  ["does not start at the nearest stop (C)", names[0] !== "C"],
  ["starts at the earliest class (A)", names[0] === "A"],
  ["untimed stop sits beside its cheapest neighbour", names.indexOf("D") === names.indexOf("A") + 1],
  ["every stop is routed exactly once", new Set(order).size === stops.length],
];

console.log(`order: ${names.join(" -> ")}`);
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failed += 1;
}
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
