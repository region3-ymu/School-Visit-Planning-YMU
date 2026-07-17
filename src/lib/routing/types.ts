export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteStopInput {
  schoolId: string;
  schoolName: string;
  lat: number;
  lng: number;
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
