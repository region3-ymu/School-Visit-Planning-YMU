const EARTH_RADIUS_M = 6371000;

/** Great-circle distance between two lat/lng points, in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Miami-Dade County bounding box — reject global false positives from geocoding. */
export const MIAMI_BOUNDS = {
  minLat: 25.14,
  maxLat: 26.05,
  minLng: -80.87,
  maxLng: -80.12,
};

export function isInMiamiBounds(lat: number, lng: number): boolean {
  return (
    lat >= MIAMI_BOUNDS.minLat &&
    lat <= MIAMI_BOUNDS.maxLat &&
    lng >= MIAMI_BOUNDS.minLng &&
    lng <= MIAMI_BOUNDS.maxLng
  );
}
