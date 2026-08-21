"use client";

import { Building2, Crosshair, Home, MapPin, Loader2 } from "lucide-react";

export type OriginMode = "home" | "gps" | "office" | "custom";

/**
 * "Where did you start from?" for a mileage leg.
 *
 * Shared by Confirm Visit and the manual Log Visit form so the three ways of
 * answering behave identically in both. GPS is hidden for a visit being logged
 * on a past date — where you are standing now says nothing about where you
 * drove from last Tuesday.
 */
export default function OriginPicker({
  mode,
  onModeChange,
  homeAddress,
  onHomeAddressChange,
  onSaveHome,
  homeSaveStatus,
  customAddress,
  onCustomAddressChange,
  gpsCoords,
  gpsError,
  gpsLoading,
  onRequestGps,
  allowGps,
  office,
}: {
  mode: OriginMode;
  onModeChange: (mode: OriginMode) => void;
  homeAddress: string;
  onHomeAddressChange: (value: string) => void;
  onSaveHome: () => void;
  homeSaveStatus: "idle" | "saving" | "saved" | "error";
  customAddress: string;
  onCustomAddressChange: (value: string) => void;
  gpsCoords: { lat: number; lng: number } | null;
  gpsError: string | null;
  gpsLoading: boolean;
  onRequestGps: () => void;
  allowGps: boolean;
  /** Omitted when no office has been seeded, which hides the option entirely. */
  office?: { name: string; address: string | null } | null;
}) {
  const modes: { value: OriginMode; label: string; icon: typeof Home }[] = [
    { value: "home", label: "Home", icon: Home },
    ...(allowGps ? [{ value: "gps" as const, label: "Current location", icon: Crosshair }] : []),
    ...(office ? [{ value: "office" as const, label: "YMU Office", icon: Building2 }] : []),
    { value: "custom", label: "Other address", icon: MapPin },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {modes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              onModeChange(value);
              if (value === "gps" && !gpsCoords) onRequestGps();
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              mode === value
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
            }`}
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {mode === "home" && (
        <div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Your home address"
              value={homeAddress}
              onChange={(e) => onHomeAddressChange(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            />
            <button
              type="button"
              onClick={onSaveHome}
              disabled={homeSaveStatus === "saving" || !homeAddress.trim()}
              className="px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-sm font-medium disabled:opacity-50"
            >
              {homeSaveStatus === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
          <p className="text-xs mt-1 text-gray-400">
            Saving updates your profile for next time.
            {homeSaveStatus === "saved" && <span className="text-emerald-600 ml-1">Saved.</span>}
            {homeSaveStatus === "error" && <span className="text-red-600 ml-1">Failed to save.</span>}
          </p>
        </div>
      )}

      {mode === "gps" && (
        <div className="text-xs">
          {gpsLoading && (
            <p className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Getting your location…
            </p>
          )}
          {!gpsLoading && gpsCoords && (
            <p className="text-emerald-600 dark:text-emerald-400">
              Using your current location ({gpsCoords.lat.toFixed(4)}, {gpsCoords.lng.toFixed(4)}).
            </p>
          )}
          {!gpsLoading && gpsError && (
            <p className="text-red-600 dark:text-red-400">
              {gpsError} — pick Home or Other address instead.
            </p>
          )}
        </div>
      )}

      {mode === "office" && office && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Starting from {office.name}
          {office.address ? ` — ${office.address}` : ""}.
        </p>
      )}

      {mode === "custom" && (
        <input
          type="text"
          placeholder="Enter address"
          value={customAddress}
          onChange={(e) => onCustomAddressChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
        />
      )}
    </div>
  );
}
