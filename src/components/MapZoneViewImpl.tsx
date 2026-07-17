"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSchools, getOptimalRouteForDay, getMyHomeLocation, setMyHomeLocation, type DayRouteResult } from "@/app/actions";
import { usePlannerStore } from "@/store/plannerStore";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  Navigation,
  MapPin,
  GripVertical,
  Route,
  Loader2,
  Home,
  Crosshair,
  RotateCcw,
  ExternalLink,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { format, addDays, startOfWeek, isTuesday } from "date-fns";
import {
  displayCoords,
  formatDistance,
  formatDuration,
} from "@/lib/routing/optimizeRoute";
import type { RouteLeg } from "@/lib/routing/types";
import { resolveStartLocation as resolveStartLocationShared } from "@/lib/routing/resolveStartLocation";

const START_LOCATION_STORAGE_KEY = "ymu-route-start-location";

type StartMode = "home" | "gps" | "custom";

interface SavedStartLocation {
  mode: StartMode;
  homeAddress: string;
  homeCoords?: { lat: number; lng: number; label?: string };
  customAddress: string;
}

const defaultSavedStart: SavedStartLocation = {
  mode: "home",
  homeAddress: "",
  customAddress: "",
};

function loadSavedStart(): SavedStartLocation {
  if (typeof window === "undefined") return defaultSavedStart;
  try {
    const raw = localStorage.getItem(START_LOCATION_STORAGE_KEY);
    if (!raw) return defaultSavedStart;
    return { ...defaultSavedStart, ...JSON.parse(raw) };
  } catch {
    return defaultSavedStart;
  }
}

function saveStartLocation(data: SavedStartLocation) {
  localStorage.setItem(START_LOCATION_STORAGE_KEY, JSON.stringify(data));
}

function numberedIcon(order: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:#4f46e5;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">${order}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const startIcon = L.divIcon({
  className: "",
  html: `<div style="background:#10b981;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)">S</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40] });
    }
  }, [map, positions]);
  return null;
}

function googleMapsUrl(route: DayRouteResult): string {
  const points = [
    `${route.start.lat},${route.start.lng}`,
    ...route.stops.map((s) => `${s.lat},${s.lng}`),
  ];
  if (points.length < 2) return `https://www.google.com/maps/search/?api=1&query=${points[0]}`;
  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

export default function MapZoneViewImpl() {
  const [schools, setSchools] = useState<
    { id: string; name: string; zipCode: string; lat: number | null; lng: number | null }[]
  >([]);
  const { plannedVisits, weekStartDateStr } = usePlannerStore();

  const weekStart = startOfWeek(new Date(weekStartDateStr), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [savedStart, setSavedStart] = useState<SavedStartLocation>(defaultSavedStart);
  const [startMode, setStartMode] = useState<StartMode>("home");
  const [homeAddress, setHomeAddress] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [departureTime, setDepartureTime] = useState("08:00");
  const [route, setRoute] = useState<DayRouteResult | null>(null);
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [homeSaveStatus, setHomeSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    getSchools().then(setSchools);
    const saved = loadSavedStart();
    setSavedStart(saved);
    setStartMode(saved.mode);
    setHomeAddress(saved.homeAddress);
    setCustomAddress(saved.customAddress);

    // DB-saved home address (per-user, syncs across devices) takes
    // precedence over whatever was cached in this browser's localStorage.
    getMyHomeLocation().then((home) => {
      if (!home) return;
      setHomeAddress(home.address);
      const coords = { lat: home.lat, lng: home.lng, label: "Home" };
      setSavedStart((prev) => {
        const next = { ...prev, homeAddress: home.address, homeCoords: coords };
        saveStartLocation(next);
        return next;
      });
    });
  }, []);

  const handleSaveHomeAddress = async () => {
    if (!homeAddress.trim()) return;
    setHomeSaveStatus("saving");
    try {
      const saved = await setMyHomeLocation(homeAddress);
      const coords = { lat: saved.lat, lng: saved.lng, label: "Home" };
      persistStartPrefs({ homeAddress: saved.address, homeCoords: coords });
      setHomeSaveStatus("saved");
    } catch {
      setHomeSaveStatus("error");
    }
  };

  const todaysVisits = useMemo(
    () =>
      plannedVisits.filter(
        (v) =>
          format(new Date(v.date), "yyyy-MM-dd") === selectedDate && !v.isSkipped && !v.isCompleted
      ),
    [plannedVisits, selectedDate]
  );

  const schoolCoordList = useMemo(
    () =>
      schools
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({ schoolId: s.id, lat: s.lat!, lng: s.lng! })),
    [schools]
  );

  const persistStartPrefs = useCallback(
    (patch: Partial<SavedStartLocation>) => {
      const next = { ...savedStart, mode: startMode, homeAddress, customAddress, ...patch };
      setSavedStart(next);
      saveStartLocation(next);
    },
    [savedStart, startMode, homeAddress, customAddress]
  );

  const resolveStartLocation = useCallback(async (): Promise<{
    type: "coordinates";
    lat: number;
    lng: number;
    label?: string;
  }> => {
    try {
      const resolved = await resolveStartLocationShared({
        mode: startMode,
        homeAddress,
        customAddress,
        cachedGps: gpsCoords,
        cachedHomeCoords: savedStart.homeCoords,
        cachedHomeAddressFor: savedStart.homeAddress,
        onGpsResolved: (coords) => {
          setGpsCoords(coords);
          setGpsError(null);
        },
        onHomeResolved: (coords) => persistStartPrefs({ homeAddress, homeCoords: coords }),
      });
      return { type: "coordinates", ...resolved };
    } catch (e) {
      if (startMode === "gps") {
        setGpsError(e instanceof Error ? e.message : "Could not get GPS location");
      }
      throw e;
    }
  }, [startMode, gpsCoords, savedStart, homeAddress, customAddress, persistStartPrefs]);

  const calculateRoute = useCallback(
    async (opts?: { reoptimize?: boolean; order?: string[] | null }) => {
      setLoading(true);
      setError(null);
      try {
        const schoolIds = todaysVisits.map((v) => v.schoolId);
        if (schoolIds.length === 0) {
          throw new Error("No planned visits for this day");
        }

        const start = await resolveStartLocation();
        const result = await getOptimalRouteForDay(
          selectedDate,
          schoolIds,
          start,
          {
            departureTime,
            manualOrder: opts?.order ?? manualOrder ?? undefined,
            reoptimize: opts?.reoptimize,
          }
        );

        setRoute(result);
        if (opts?.reoptimize || !opts?.order) {
          setManualOrder(result.stops.map((s) => s.schoolId));
        } else if (opts.order) {
          setManualOrder(opts.order);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to calculate route");
      } finally {
        setLoading(false);
      }
    },
    [todaysVisits, selectedDate, resolveStartLocation, departureTime, manualOrder]
  );

  const handleDrop = async (fromIndex: number, toIndex: number) => {
    if (!route || fromIndex === toIndex) return;
    const ids = [...route.stops.map((s) => s.schoolId)];
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    setManualOrder(ids);
    await calculateRoute({ order: ids });
  };

  const mapCenter: [number, number] = route
    ? [route.start.lat, route.start.lng]
    : schools[0]?.lat && schools[0]?.lng
      ? [schools[0].lat, schools[0].lng]
      : [25.7617, -80.1918];

  const fitPositions: [number, number][] = route
    ? [
        [route.start.lat, route.start.lng],
        ...route.stops.map((s) => [s.lat, s.lng] as [number, number]),
      ]
    : [];

  const displayStops: RouteLeg[] = route?.stops ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[600px] p-4 gap-4">
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Map — 60% landscape */}
        <div className="lg:w-[60%] flex-1 min-h-[300px] bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm relative z-0">
          <MapContainer
            center={mapCenter}
            zoom={11}
            scrollWheelZoom={true}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {fitPositions.length > 0 && <FitBounds positions={fitPositions} />}

            {/* All school markers (faded when route active) */}
            {schools.map((school) => {
              if (school.lat == null || school.lng == null) return null;
              const inRoute = displayStops.some((s) => s.schoolId === school.id);
              if (route && inRoute) return null;
              const pos = displayCoords(
                school.lat,
                school.lng,
                school.id,
                schoolCoordList
              );
              return (
                <Marker key={school.id} position={pos} opacity={route ? 0.35 : 1}>
                  <Popup>
                    <h3 className="font-bold text-sm">{school.name}</h3>
                    <p className="text-xs text-gray-600">Zip: {school.zipCode}</p>
                  </Popup>
                </Marker>
              );
            })}

            {route && (
              <>
                <Marker position={[route.start.lat, route.start.lng]} icon={startIcon}>
                  <Popup>
                    <strong>Start</strong>
                    <br />
                    {route.start.label ?? "Departure"}
                  </Popup>
                </Marker>

                {displayStops.map((stop) => {
                  const pos = displayCoords(
                    stop.lat,
                    stop.lng,
                    stop.schoolId,
                    displayStops.map((s) => ({
                      schoolId: s.schoolId,
                      lat: s.lat,
                      lng: s.lng,
                    }))
                  );
                  return (
                    <Marker key={stop.schoolId} position={pos} icon={numberedIcon(stop.order)}>
                      <Popup>
                        <h3 className="font-bold text-sm">
                          {stop.order}. {stop.schoolName}
                        </h3>
                        <p className="text-xs mt-1">Arrive: {stop.arrivalTime}</p>
                        <p className="text-xs">
                          +{formatDuration(stop.legDurationSec)} ({formatDistance(stop.legDistanceM)})
                        </p>
                      </Popup>
                    </Marker>
                  );
                })}

                {route.polyline.length > 1 && (
                  <Polyline
                    positions={route.polyline}
                    color="#4f46e5"
                    weight={5}
                    opacity={0.85}
                  />
                )}
              </>
            )}

            {/* Legacy straight-line polylines only when no optimized route */}
            {!route &&
              Object.entries(
                plannedVisits.reduce(
                  (acc, visit) => {
                    const d = format(new Date(visit.date), "yyyy-MM-dd");
                    if (!acc[d]) acc[d] = [];
                    const s = schools.find((sch) => sch.id === visit.schoolId);
                    if (s?.lat && s?.lng) acc[d].push([s.lat, s.lng]);
                    return acc;
                  },
                  {} as Record<string, [number, number][]>
                )
              ).map(([date, coords], idx) => {
                const colors = ["#94a3b8", "#cbd5e1"];
                return coords.length > 1 ? (
                  <Polyline
                    key={date}
                    positions={coords}
                    color={colors[idx % colors.length]}
                    weight={2}
                    opacity={0.35}
                    dashArray="6, 8"
                  />
                ) : null;
              })}
          </MapContainer>
        </div>

        {/* Side panel — 40% landscape */}
        <div className="lg:w-[40%] flex flex-col gap-3 overflow-y-auto min-h-0">
          <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Route className="text-indigo-600" size={22} />
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                Plan today&apos;s route
              </h2>
            </div>

            {/* Date picker */}
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Visit day
            </label>
            <select
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setRoute(null);
                setManualOrder(null);
              }}
              className="w-full min-h-[44px] px-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm mb-3"
            >
              {weekDays.map((d) => (
                <option key={d.toISOString()} value={format(d, "yyyy-MM-dd")}>
                  {format(d, "EEEE, MMM d")}
                  {isTuesday(d) ? " (e.g. Central)" : ""}
                </option>
              ))}
            </select>

            {/* Start location */}
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
              Starting from
            </p>
            <div className="flex flex-col gap-2 mb-3">
              {(
                [
                  { mode: "home" as const, icon: Home, label: "Home address" },
                  { mode: "gps" as const, icon: Crosshair, label: "Current GPS" },
                  { mode: "custom" as const, icon: MapPin, label: "Custom address" },
                ] as const
              ).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setStartMode(mode);
                    persistStartPrefs({ mode });
                  }}
                  className={`flex items-center gap-2 min-h-[44px] px-3 rounded-lg border text-sm font-medium transition-colors ${
                    startMode === mode
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                      : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>

            {startMode === "home" && (
              <div className="mb-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Your home address"
                    value={homeAddress}
                    onChange={(e) => {
                      setHomeAddress(e.target.value);
                      setHomeSaveStatus("idle");
                    }}
                    onBlur={() => persistStartPrefs({ homeAddress })}
                    className="flex-1 min-h-[44px] px-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSaveHomeAddress}
                    disabled={homeSaveStatus === "saving" || !homeAddress.trim()}
                    className="min-h-[44px] px-3 rounded-lg border border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-sm font-medium disabled:opacity-50"
                  >
                    {homeSaveStatus === "saving" ? "Saving…" : "Save"}
                  </button>
                </div>
                <p className="text-xs mt-1 text-gray-500">
                  Saving stores this address to your profile so it&apos;s also used to calculate mileage
                  when confirming visits.
                  {homeSaveStatus === "saved" && <span className="text-emerald-600 ml-1">Saved.</span>}
                  {homeSaveStatus === "error" && <span className="text-red-600 ml-1">Failed to save.</span>}
                </p>
              </div>
            )}
            {startMode === "custom" && (
              <input
                type="text"
                placeholder="Enter address"
                value={customAddress}
                onChange={(e) => setCustomAddress(e.target.value)}
                onBlur={() => persistStartPrefs({ customAddress })}
                className="w-full min-h-[44px] px-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm mb-3"
              />
            )}
            {startMode === "gps" && gpsError && (
              <p className="text-sm text-red-600 mb-2">{gpsError}</p>
            )}
            {startMode === "gps" && gpsCoords && (
              <p className="text-xs text-gray-500 mb-2">
                GPS: {gpsCoords.lat.toFixed(5)}, {gpsCoords.lng.toFixed(5)}
              </p>
            )}

            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Departure time
            </label>
            <input
              type="time"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm mb-3"
            />

            {/* Today's visits */}
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Planned visits ({todaysVisits.length})
            </p>
            {todaysVisits.length === 0 ? (
              <p className="text-sm text-gray-500 mb-3">
                No visits planned for this day. Add visits in the Weekly Planner first.
              </p>
            ) : (
              <ul className="text-sm text-gray-600 dark:text-gray-300 mb-3 space-y-1">
                {todaysVisits.map((v) => (
                  <li key={v.schoolId} className="flex items-center gap-2">
                    <MapPin size={14} className="text-indigo-400 shrink-0" />
                    {v.schoolName}
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              disabled={loading || todaysVisits.length === 0}
              onClick={() => calculateRoute({ reoptimize: true })}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Navigation size={18} />
              )}
              Calculate route
            </button>

            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          {/* Route summary + reorder */}
          {route && (
            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="font-bold text-gray-800 dark:text-gray-100">
                  {route.stops.length} stops, {formatDuration(route.totalDurationSec)},{" "}
                  {formatDistance(route.totalDistanceM)}
                </p>
                <a
                  href={googleMapsUrl(route)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-200 dark:border-zinc-700 text-indigo-600"
                  title="Open in Google Maps"
                >
                  <ExternalLink size={18} />
                </a>
              </div>

              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => calculateRoute({ reoptimize: true })}
                  disabled={loading}
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-lg border border-indigo-300 text-indigo-700 dark:text-indigo-300 text-sm font-medium"
                >
                  <RotateCcw size={16} />
                  Re-optimize
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-2">Drag to reorder stops</p>
              <ul className="space-y-2">
                {displayStops.map((stop, index) => (
                  <li
                    key={stop.schoolId}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) handleDrop(dragIndex, index);
                      setDragIndex(null);
                    }}
                    className={`flex items-center gap-2 p-3 rounded-lg border min-h-[52px] ${
                      dragIndex === index
                        ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20"
                        : "border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50"
                    }`}
                  >
                    <span
                      className="cursor-grab active:cursor-grabbing p-2 -m-1 touch-manipulation"
                      aria-label="Drag to reorder"
                    >
                      <GripVertical size={22} className="text-gray-400" />
                    </span>
                    <span className="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                      {stop.order}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-800 dark:text-gray-100 truncate">
                        {stop.schoolName}
                      </p>
                      <p className="text-xs text-gray-500">
                        Arrive {stop.arrivalTime} · +{formatDuration(stop.legDurationSec)} ·{" "}
                        {formatDistance(stop.legDistanceM)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0 || loading}
                        onClick={() => handleDrop(index, index - 1)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-200 dark:border-zinc-700 disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ChevronUp size={20} />
                      </button>
                      <button
                        type="button"
                        disabled={index === displayStops.length - 1 || loading}
                        onClick={() => handleDrop(index, index + 1)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-200 dark:border-zinc-700 disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ChevronDown size={20} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
