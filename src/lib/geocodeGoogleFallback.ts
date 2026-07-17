import { isInMiamiBounds } from "./geo";

/**
 * Google Geocoding API fallback — only used when OpenRouteService's free
 * Pelias/OSM-based geocoder can't find an address/street-level match.
 * ORS stays the primary geocoder everywhere; this only fires on failure,
 * so at YMU's volume it stays well within Google's free monthly quota.
 *
 * No-op unless GOOGLE_MAPS_API_KEY is set — safe to leave unconfigured.
 */

export function hasGoogleGeocodingKey(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

// Google's precision tiers for geocode results. Only trust the two that are
// address-level — reject APPROXIMATE/GEOMETRIC_CENTER (city/region-level),
// which is exactly the class of silent false-positive ORS was giving us.
const ACCEPTABLE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

export type GoogleGeocodeResult = { lat: number; lng: number; label: string };

export async function geocodeAddressGoogle(address: string): Promise<GoogleGeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  // Bias toward Miami-Dade (southwest|northeast corners).
  url.searchParams.set("bounds", "25.14,-80.87|26.05,-80.12");
  url.searchParams.set("region", "us");

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = (await res.json()) as {
    status?: string;
    results?: {
      geometry?: { location?: { lat: number; lng: number }; location_type?: string };
      formatted_address?: string;
    }[];
  };
  if (data.status !== "OK") return null;

  const best = data.results?.find((r) => ACCEPTABLE_LOCATION_TYPES.has(r.geometry?.location_type ?? ""));
  const loc = best?.geometry?.location;
  if (!loc) return null;
  if (!isInMiamiBounds(loc.lat, loc.lng)) return null;

  return { lat: loc.lat, lng: loc.lng, label: best.formatted_address ?? address };
}
