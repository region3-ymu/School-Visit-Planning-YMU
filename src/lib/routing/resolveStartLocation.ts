import type { LatLng } from "./types";

export type StartMode = "home" | "gps" | "custom";

export type ResolvedLocation = { lat: number; lng: number; label?: string };

type ResolveParams = {
  mode: StartMode;
  homeAddress?: string;
  customAddress?: string;
  /** Already-resolved GPS coords from an earlier call this session, if any. */
  cachedGps?: LatLng | null;
  /** Already-geocoded home coords, valid only if they match `cachedHomeAddressFor`. */
  cachedHomeCoords?: ResolvedLocation | null;
  cachedHomeAddressFor?: string;
  onGpsResolved?: (coords: LatLng) => void;
  onHomeResolved?: (coords: ResolvedLocation) => void;
};

async function geocode(address: string): Promise<ResolvedLocation> {
  const res = await fetch("/api/routing/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Geocoding failed");
  return { lat: data.lat, lng: data.lng, label: data.label };
}

function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Could not get GPS location")),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

/**
 * Resolves a start/origin location for one of the three shared modes (home
 * saved address / current GPS / a one-off custom address). Used by both the
 * Map day-route planner and the Confirm Visit modal so the "where are you
 * starting from" behavior is identical in both places.
 */
export async function resolveStartLocation(params: ResolveParams): Promise<ResolvedLocation> {
  const { mode, homeAddress, customAddress, cachedGps, cachedHomeCoords, cachedHomeAddressFor, onGpsResolved, onHomeResolved } = params;

  if (mode === "gps") {
    if (cachedGps) return { ...cachedGps, label: "Current location" };
    const coords = await getCurrentPosition();
    onGpsResolved?.(coords);
    return { ...coords, label: "Current location" };
  }

  if (mode === "home") {
    if (cachedHomeCoords && homeAddress && homeAddress === cachedHomeAddressFor) {
      return { ...cachedHomeCoords, label: cachedHomeCoords.label ?? "Home" };
    }
    if (!homeAddress?.trim()) {
      throw new Error("No home address set");
    }
    const coords = await geocode(homeAddress);
    const withLabel = { ...coords, label: coords.label ?? "Home" };
    onHomeResolved?.(withLabel);
    return withLabel;
  }

  // custom
  if (!customAddress?.trim()) {
    throw new Error("No custom address entered");
  }
  const coords = await geocode(customAddress);
  return { ...coords, label: coords.label ?? customAddress };
}
