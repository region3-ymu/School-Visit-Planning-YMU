/**
 * Geocode a school via OpenRouteService Pelias search.
 * Query: "${address}, Miami-Dade County, FL" if address is populated,
 *        "${name}, Miami FL" otherwise.
 * Falls back to Google Geocoding (if GOOGLE_MAPS_API_KEY is set) when ORS
 * can't find an address/street-level match.
 */

import { MIAMI_BOUNDS, isInMiamiBounds } from "./geo";
import { geocodeAddressGoogle } from "./geocodeGoogleFallback";

const ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search";

export function getOrsApiKey(): string {
  const key = (process.env.OPENROUTE_SERVICE_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("OPENROUTE_SERVICE_API_KEY is required");
  }
  return key;
}

// Pelias precision layers we trust. "locality"/"region"/etc. mean the exact
// address/venue wasn't found and ORS silently fell back to a general-area
// match — accepting that as-is produces coordinates that look valid (they
// pass the Miami-Dade bounds check) but can be miles from the real school.
const ACCEPTABLE_LAYERS = new Set(["address", "street", "venue"]);

export type GeocodeResult = { lat: number; lng: number };

/** Returns coordinates for the first geocode hit in Miami-Dade, or null if lookup fails. */
export async function geocodeSchoolByName(
  schoolName: string,
  address?: string | null
): Promise<GeocodeResult | null> {
  const apiKey = getOrsApiKey();
  const text = address?.trim()
    ? `${address.trim()}, Miami-Dade County, FL`
    : `${schoolName}, Miami FL`;

  const url = new URL(ORS_GEOCODE_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("text", text);
  url.searchParams.set("size", "5");
  url.searchParams.set("boundary.rect.min_lon", String(MIAMI_BOUNDS.minLng));
  url.searchParams.set("boundary.rect.min_lat", String(MIAMI_BOUNDS.minLat));
  url.searchParams.set("boundary.rect.max_lon", String(MIAMI_BOUNDS.maxLng));
  url.searchParams.set("boundary.rect.max_lat", String(MIAMI_BOUNDS.maxLat));

  try {
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = (await res.json()) as {
        features?: { geometry?: { coordinates?: [number, number] }; properties?: { layer?: string } }[];
      };

      const features = data.features ?? [];
      const best = features.find((f) => ACCEPTABLE_LAYERS.has(f.properties?.layer ?? ""));
      const coords = best?.geometry?.coordinates;

      if (coords) {
        const [lng, lat] = coords;
        if (Number.isFinite(lat) && Number.isFinite(lng) && isInMiamiBounds(lat, lng)) {
          return { lat, lng };
        }
      }
    }
  } catch {
    // fall through to Google
  }

  // ORS didn't find an address/venue-level match — try Google (no-op if
  // GOOGLE_MAPS_API_KEY isn't set).
  try {
    const googleResult = await geocodeAddressGoogle(text);
    if (googleResult) return { lat: googleResult.lat, lng: googleResult.lng };
  } catch {
    // ignore — caller treats this the same as "not found"
  }

  return null;
}

export { isInMiamiBounds };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
