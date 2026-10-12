"use client";

import { MapPin, AlertTriangle, Loader2 } from "lucide-react";
import { GEOFENCE_RADIUS_M, type GeofenceStatus } from "./useGeofence";

/** The geofence result as both visit forms show it, with the override box. */
export default function GeofenceNotice({
  status,
  distanceM,
  error,
  schoolName,
  override,
  onOverrideChange,
  actionLabel = "Confirm",
}: {
  status: GeofenceStatus;
  distanceM: number | null;
  error: string | null;
  schoolName: string;
  override: boolean;
  onOverrideChange: (value: boolean) => void;
  /** The verb on the button this notice gates ("Confirm", "Save"). */
  actionLabel?: string;
}) {
  if (status === "idle") return null;
  return (
    <div
      className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
        status === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
          : status === "checking"
            ? "border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-gray-400"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
      }`}
    >
      {status === "checking" ? (
        <Loader2 size={16} className="animate-spin shrink-0 mt-0.5" />
      ) : status === "ok" ? (
        <MapPin size={16} className="shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      )}
      <div className="flex-1">
        {status === "checking" && <p>Checking your location…</p>}
        {status === "ok" && <p>You&apos;re at the school ({Math.round(distanceM ?? 0)}m away).</p>}
        {status === "far" && (
          <p>
            You&apos;re {Math.round(distanceM ?? 0)}m from {schoolName} — more than {GEOFENCE_RADIUS_M}m.{" "}
            {actionLabel} button is disabled unless you override.
          </p>
        )}
        {status === "error" && <p>{error ?? "Could not check your location."}</p>}
        {status === "no-target" && <p>This school has no saved location, so distance can&apos;t be verified.</p>}
        {status !== "ok" && status !== "checking" && (
          <label className="mt-2 flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input type="checkbox" checked={override} onChange={(e) => onOverrideChange(e.target.checked)} />
            {actionLabel} anyway
          </label>
        )}
      </div>
    </div>
  );
}
