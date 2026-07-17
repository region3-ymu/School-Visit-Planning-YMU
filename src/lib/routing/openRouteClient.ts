import type { LatLng } from "./types";
import { MIAMI_BOUNDS, isInMiamiBounds } from "@/lib/geo";
import { geocodeAddressGoogle } from "@/lib/geocodeGoogleFallback";

const ORS_DIRECTIONS_URL =
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
const ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search";

function getApiKey(): string {
  const key = process.env.OPENROUTE_SERVICE_API_KEY ?? "";
  if (!key) {
    throw new Error("OPENROUTE_SERVICE_API_KEY is required");
  }
  return key;
}

/** Fetch driving route polyline as [lat, lng][] via OpenRouteService Directions API. */
export async function getDrivingPolyline(
  waypoints: LatLng[]
): Promise<[number, number][]> {
  if (waypoints.length < 2) return waypoints.map((p) => [p.lat, p.lng]);

  const apiKey = getApiKey();
  const coordinates = waypoints.map((p) => [p.lng, p.lat]);

  const res = await fetch(ORS_DIRECTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ coordinates }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouteService directions failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number][] } }[];
  };

  const coords = data.features?.[0]?.geometry?.coordinates ?? [];
  return coords.map(([lng, lat]) => [lat, lng]);
}

// Pelias precision layers we trust for a street address. Anything coarser
// (locality/city, region, country, etc.) means the exact address wasn't
// found and ORS silently fell back to a general-area match — accepting
// that as-is can place "home" many miles from the real address.
const ACCEPTABLE_LAYERS = new Set(["address", "street", "venue"]);

/** Geocode a free-text address to lat/lng via OpenRouteService. */
export async function geocodeAddress(
  address: string
): Promise<LatLng & { label: string }> {
  const apiKey = getApiKey();
  const url = new URL(ORS_GEOCODE_URL);
  url.searchParams.set("text", address);
  url.searchParams.set("size", "5");
  // Bias/restrict to Miami-Dade — without this, an ambiguous or malformed
  // address (e.g. "103 rd st" instead of "103rd St") can silently match a
  // similarly-named street in a completely different city.
  url.searchParams.set("boundary.rect.min_lon", String(MIAMI_BOUNDS.minLng));
  url.searchParams.set("boundary.rect.min_lat", String(MIAMI_BOUNDS.minLat));
  url.searchParams.set("boundary.rect.max_lon", String(MIAMI_BOUNDS.maxLng));
  url.searchParams.set("boundary.rect.max_lat", String(MIAMI_BOUNDS.maxLat));

  const res = await fetch(url.toString(), {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouteService geocode failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    features?: {
      geometry?: { coordinates?: [number, number] };
      properties?: { label?: string; layer?: string };
    }[];
  };

  const features = data.features ?? [];
  const best = features.find((f) => ACCEPTABLE_LAYERS.has(f.properties?.layer ?? ""));
  const coords = best?.geometry?.coordinates;

  if (coords) {
    const [lng, lat] = coords;
    if (isInMiamiBounds(lat, lng)) {
      return { lat, lng, label: best.properties?.label ?? address };
    }
  }

  // ORS didn't find an address/street-level match in Miami-Dade — fall back
  // to Google (only fires when GOOGLE_MAPS_API_KEY is configured; ORS is
  // otherwise the sole geocoder, so this stays free at YMU's volume).
  const googleResult = await geocodeAddressGoogle(address);
  if (googleResult) return googleResult;

  const closestLayer = features[0]?.properties?.layer;
  throw new Error(
    closestLayer
      ? `Could not find the exact address "${address}" — only a general area match was found (${closestLayer}). Try adding more detail (unit, ZIP, cross street).`
      : `No results found for address: ${address}`
  );
}
