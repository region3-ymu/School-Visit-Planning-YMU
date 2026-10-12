"use client";

import { useEffect, useState } from "react";
import { getSchoolLocation } from "@/app/actions";
import { haversineMeters } from "@/lib/geo";

export const GEOFENCE_RADIUS_M = 250;

export type GeofenceStatus = "idle" | "checking" | "ok" | "far" | "error" | "no-target";

/**
 * "Is the phone at this school right now?" — the check both ways of recording
 * an in-person visit run: confirming a planned one (ConfirmVisitModal) and the
 * Log Visit form (VisitHistory).
 *
 * It used to live only in the first. Once the Dashboard's "Log a visit" button
 * made the second the quick path, visits stopped carrying a location at all
 * (YMU 2026-10-12: "the GPS stopped working" — it hadn't, it was never asked).
 *
 * `enabled` is false for a remote visit, an earlier day (where the phone is
 * now says nothing about then) or no school picked yet; the status is then
 * "idle" and nothing is asked of the browser.
 *
 * The coordinates come back too, so a caller can offer them as a mileage
 * origin without prompting for GPS a second time.
 */
export function useGeofence(
  schoolId: string | null,
  enabled: boolean,
  hint?: { lat: number | null | undefined; lng: number | null | undefined },
) {
  const [status, setStatus] = useState<GeofenceStatus>(enabled ? "checking" : "idle");
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const hintLat = hint?.lat ?? null;
  const hintLng = hint?.lng ?? null;

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the check is the browser's geolocation, which only exists after mount. */
    setDistanceM(null);
    setError(null);
    if (!enabled || !schoolId) {
      setStatus("idle");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("error");
      setError("Geolocation is not supported by this browser");
      return;
    }
    setStatus("checking");
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;

    // Asked for up front, in parallel with the GPS fix, so it costs nothing:
    // the browser takes seconds to answer, the database takes milliseconds.
    // The school's own row is the authority on where it is; the hint (a plan
    // item's coordinates) only covers a failed lookup.
    const targetPromise = getSchoolLocation(schoolId).catch(() => null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(here);

        const stored = await targetPromise;
        if (cancelled) return;
        const target = stored ?? (hintLat != null && hintLng != null ? { lat: hintLat, lng: hintLng } : null);
        if (!target) {
          setStatus("no-target");
          return;
        }
        const distance = haversineMeters(here.lat, here.lng, target.lat, target.lng);
        setDistanceM(distance);
        setStatus(distance <= GEOFENCE_RADIUS_M ? "ok" : "far");
      },
      (err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err.message || "Could not get GPS location");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );

    return () => {
      cancelled = true;
    };
  }, [schoolId, enabled, hintLat, hintLng]);

  return { status, distanceM, error, coords };
}
