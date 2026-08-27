export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteStopInput {
  schoolId: string;
  schoolName: string;
  lat: number;
  lng: number;
  /**
   * "HH:mm" of the class this visit is aimed at, in Miami time. Absent for a
   * stop with no class to catch — an admin drop-in, or the office.
   */
  classTime?: string;
}

export interface RouteLeg {
  schoolId: string;
  schoolName: string;
  lat: number;
  lng: number;
  order: number;
  legDurationSec: number;
  legDistanceM: number;
  cumulativeDurationSec: number;
  cumulativeDistanceM: number;
  arrivalTime: string;
  /** The class this stop is for, if it has one. */
  classTime?: string;
  /**
   * True when the estimated arrival is after the class starts. The route is
   * still returned — an RM who is going anyway needs to see it — but it says
   * so rather than presenting an impossible day as a solved one.
   */
  arrivesLate?: boolean;
}

export interface OptimizedRouteResult {
  stops: RouteLeg[];
  totalDurationSec: number;
  totalDistanceM: number;
  start: LatLng & { label?: string };
}

export type StartLocationInput =
  | { type: "coordinates"; lat: number; lng: number; label?: string }
  | { type: "address"; address: string };
