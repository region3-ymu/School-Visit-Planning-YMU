"use client";

import { useEffect, useState } from "react";
import { X, MapPin, AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { isToday } from "date-fns";
import { confirmVisit, getPreviousVisitToday, getMyHomeLocation, setMyHomeLocation, getOfficeLocations, getSchoolLocation } from "@/app/actions";
import { haversineMeters } from "@/lib/geo";
import OriginPicker, { type OriginMode } from "./visit/OriginPicker";
import VehiclePicker, { type VehicleType } from "./visit/VehiclePicker";
import TeacherObservationFields, {
  EMPTY_OBSERVATIONS,
  type ObservationDomainKey,
  type ObservationRating,
  type ObservationSkipReason,
  type ObservationState,
} from "./visit/TeacherObservationFields";

type ChainState =
  | { status: "loading" }
  | { status: "chained"; label: string }
  | { status: "needs-input" };

const GEOFENCE_RADIUS_M = 250;

const VISITED_WITH_OPTIONS: { value: string; label: string }[] = [
  { value: "PRINCIPAL", label: "Principal" },
  { value: "MAIN_OFFICE", label: "Main Office" },
  { value: "INSCHOOL_MUSIC_TEACHER", label: "In-school music teacher" },
  { value: "YMU_TEACHER", label: "YMU teacher" },
];

const TALK_ABOUT_TRIGGERS = ["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER"];

type GeofenceStatus = "checking" | "ok" | "far" | "error" | "no-target";

export default function ConfirmVisitModal({
  schoolId,
  schoolName,
  visitDate,
  schoolLat,
  schoolLng,
  subjectName,
  teacherId,
  teacherName,
  onClose,
  onConfirmed,
}: {
  schoolId: string;
  schoolName: string;
  visitDate: Date;
  schoolLat?: number;
  schoolLng?: number;
  subjectName?: string;
  /** The teacher whose class this slot is — the ratings below are about them. */
  teacherId?: string;
  teacherName?: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // Not every visit is a drive. Online and phone visits still record who was
  // met and what came of it, but there is no location to verify, no leg to
  // bill as mileage, and no class in the room to observe.
  const [mode, setMode] = useState<"IN_PERSON" | "ONLINE" | "PHONE">("IN_PERSON");
  const isRemote = mode !== "IN_PERSON";

  // Confirming a visit from an earlier day. Where the phone is now says nothing
  // about that day, so neither the geofence nor "current location" as an origin
  // means anything — the same rule the manual Log Visit form already applied.
  const isBackdated = !isToday(visitDate);

  const [geofenceStatus, setGeofenceStatus] = useState<GeofenceStatus>("checking");
  const [geofenceDistanceM, setGeofenceDistanceM] = useState<number | null>(null);
  const [geofenceError, setGeofenceError] = useState<string | null>(null);
  const [overrideGeofence, setOverrideGeofence] = useState(false);

  const [chainState, setChainState] = useState<ChainState>({ status: "loading" });
  const [originMode, setOriginMode] = useState<OriginMode>("home");
  const [homeAddress, setHomeAddress] = useState("");
  const [savedHomeAddress, setSavedHomeAddress] = useState<{ address: string; lat: number; lng: number } | null>(null);
  const [homeSaveStatus, setHomeSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [customAddress, setCustomAddress] = useState("");
  // The geofence check below already asks the browser for a fix; reusing it as a
  // possible mileage origin means the RM is never prompted for GPS twice.
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleType>("PERSONAL");
  type Office = Awaited<ReturnType<typeof getOfficeLocations>>[number];
  const [office, setOffice] = useState<Office | null>(null);

  const [visitedWith, setVisitedWith] = useState<string[]>([]);
  const [principalNotes, setPrincipalNotes] = useState("");
  const [hasInstrumentRequest, setHasInstrumentRequest] = useState(false);
  const [instrumentRequestDetails, setInstrumentRequestDetails] = useState("");
  const [observations, setObservations] = useState<ObservationState>(EMPTY_OBSERVATIONS);
  const [obsNotes, setObsNotes] = useState("");
  const [obsSkipReason, setObsSkipReason] = useState<ObservationSkipReason | null>(null);
  const [obsSkipNotes, setObsSkipNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isBackdated) return;
    if (!navigator.geolocation) {
      setGeofenceStatus("error");
      setGeofenceError("Geolocation is not supported by this browser");
      return;
    }
    let cancelled = false;

    // Asked for up front, in parallel with the GPS fix, so it costs nothing:
    // the browser takes seconds to answer, the database takes milliseconds.
    //
    // The props are only a hint. Where a school IS lives in one place — its
    // row — and the plan item that opened this modal is not that place: a
    // pinned visit or a plan rehydrated from localStorage by an older build
    // can arrive without coordinates, and then this screen told a Regional
    // Manager that a school with a perfectly good address on file had no
    // saved location. Falling back to the props keeps the check working if
    // the lookup itself fails.
    const targetPromise = getSchoolLocation(schoolId).catch(() => null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });

        const stored = await targetPromise;
        if (cancelled) return;
        const target =
          stored ??
          (schoolLat != null && schoolLng != null ? { lat: schoolLat, lng: schoolLng } : null);
        if (!target) {
          setGeofenceStatus("no-target");
          return;
        }
        const distance = haversineMeters(pos.coords.latitude, pos.coords.longitude, target.lat, target.lng);
        setGeofenceDistanceM(distance);
        setGeofenceStatus(distance <= GEOFENCE_RADIUS_M ? "ok" : "far");
      },
      (err) => {
        if (cancelled) return;
        setGeofenceStatus("error");
        setGeofenceError(err.message || "Could not get GPS location");
        setGpsError(err.message || "Could not get GPS location");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );

    return () => {
      cancelled = true;
    };
  }, [schoolId, schoolLat, schoolLng, isBackdated]);

  useEffect(() => {
    getPreviousVisitToday(visitDate.toISOString()).then((prev) => {
      setChainState(prev ? { status: "chained", label: prev.label } : { status: "needs-input" });
    });
    getMyHomeLocation().then((home) => {
      if (home) {
        setSavedHomeAddress(home);
        setHomeAddress(home.address);
      }
    });
    getOfficeLocations().then((list) => setOffice(list[0] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveHomeAddress = async () => {
    if (!homeAddress.trim()) return;
    setHomeSaveStatus("saving");
    try {
      const saved = await setMyHomeLocation(homeAddress);
      setSavedHomeAddress(saved);
      setHomeAddress(saved.address);
      setHomeSaveStatus("saved");
    } catch {
      setHomeSaveStatus("error");
    }
  };

  const hasOrigin =
    originMode === "home"
      ? !!homeAddress.trim()
      : originMode === "gps"
        ? !!gpsCoords
        : originMode === "office"
          ? !!office
          : !!customAddress.trim();

  const hasStartingPoint = chainState.status !== "needs-input" || hasOrigin;
  const canConfirm =
    isRemote ||
    (isBackdated
      ? hasStartingPoint
      : (geofenceStatus === "ok" || overrideGeofence) && hasStartingPoint);

  const toggleVisitedWith = (value: string) => {
    setVisitedWith((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const showTalkAbout = visitedWith.some((v) => TALK_ABOUT_TRIGGERS.includes(v));
  const showTeacherObservation = !isRemote && visitedWith.includes("YMU_TEACHER");
  const skippedObs = showTeacherObservation && obsSkipReason !== null;

  const setObservation = (key: ObservationDomainKey, value: ObservationRating) => {
    setObservations((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
  };

  const handleSubmit = async () => {
    setFormError(null);

    if (hasInstrumentRequest && !instrumentRequestDetails.trim()) {
      setFormError("Please describe the instrument request or repair needed.");
      return;
    }

    setSubmitting(true);
    try {
      let origin: { lat: number; lng: number; label?: string; isHome?: boolean } | undefined;

      if (!isRemote && chainState.status === "needs-input") {
        if (originMode === "gps") {
          if (!gpsCoords) throw new Error("Still waiting on your location — pick Home or Other address instead.");
          origin = { ...gpsCoords, label: "Current location" };
        } else if (originMode === "office") {
          if (!office?.lat || !office.lng) throw new Error("The office has no saved location.");
          origin = { lat: office.lat, lng: office.lng, label: office.name };
        } else if (originMode === "home" && savedHomeAddress && homeAddress.trim() === savedHomeAddress.address) {
          origin = { lat: savedHomeAddress.lat, lng: savedHomeAddress.lng, label: "Home", isHome: true };
        } else {
          const addressToGeocode = originMode === "home" ? homeAddress.trim() : customAddress.trim();
          const res = await fetch("/api/routing/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: addressToGeocode }),
          });
          const geo = await res.json();
          if (!res.ok) throw new Error(geo.error ?? "Could not find that address");
          origin = {
            lat: geo.lat,
            lng: geo.lng,
            label: originMode === "home" ? "Home" : geo.label,
            // Starting from home makes this the morning commute, which is not paid.
            isHome: originMode === "home",
          };
        }
      }

      await confirmVisit(schoolId, visitDate.toISOString(), {
        mode,
        vehicle,
        // Only meaningful alongside a rubric; a phone call observes nobody.
        observedTeacherId: showTeacherObservation ? teacherId : undefined,
        origin,
        visitedWith,
        principalNotes: showTalkAbout ? principalNotes.trim() || undefined : undefined,
        hasInstrumentRequest,
        instrumentRequestDetails: hasInstrumentRequest ? instrumentRequestDetails.trim() : undefined,
        geofenceDistanceM: isRemote || isBackdated ? undefined : geofenceDistanceM ?? undefined,
        geofenceOverridden: isRemote ? false : isBackdated || geofenceStatus !== "ok",
        // A skipped observation carries a reason instead of ratings, never both.
        obsPlanningPrep: skippedObs ? undefined : observations.obsPlanningPrep ?? undefined,
        obsCultureManagement: skippedObs ? undefined : observations.obsCultureManagement ?? undefined,
        obsInstructionMusicianship: skippedObs ? undefined : observations.obsInstructionMusicianship ?? undefined,
        obsEngagementEvidence: skippedObs ? undefined : observations.obsEngagementEvidence ?? undefined,
        obsProfessionalismGrowth: skippedObs ? undefined : observations.obsProfessionalismGrowth ?? undefined,
        obsNotes: showTeacherObservation && !skippedObs ? obsNotes.trim() || undefined : undefined,
        obsSkipReason: skippedObs ? obsSkipReason ?? undefined : undefined,
        obsSkipNotes: skippedObs ? obsSkipNotes.trim() || undefined : undefined,
      });

      onConfirmed();
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to confirm visit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90dvh] flex flex-col">
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center bg-gray-50 dark:bg-zinc-800/50 shrink-0">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center">
            <CheckCircle2 size={18} className="mr-2 text-emerald-500 shrink-0" />
            <span>
              Confirm Visit — {schoolName}
              {subjectName && (
                <span className="block text-xs font-medium text-indigo-600 dark:text-indigo-400">{subjectName}</span>
              )}
            </span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* How the visit happened. Chosen first, because it decides whether
              the rest of the form asks about location and the classroom. */}
          <div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">How did this visit happen?</p>
            <div className="flex gap-2">
              {([
                { value: "IN_PERSON", label: "In person" },
                { value: "ONLINE", label: "Online" },
                { value: "PHONE", label: "Phone call" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    mode === opt.value
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {isRemote && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                No location check and no mileage for this visit, since you didn&apos;t travel.
              </p>
            )}
          </div>

          {!isRemote && <VehiclePicker value={vehicle} onChange={setVehicle} />}

          {/* A backdated confirmation can't be location-checked; it is recorded
              as unverified rather than pretending otherwise. */}
          {!isRemote && isBackdated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <Clock size={16} className="shrink-0 mt-0.5" />
              <p>Logging an earlier day, so your location isn&apos;t checked and is recorded as unverified.</p>
            </div>
          )}

          {/* Geofence status */}
          {!isRemote && !isBackdated && (
          <div
            className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
              geofenceStatus === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
                : geofenceStatus === "checking"
                  ? "border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-gray-400"
                  : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
            }`}
          >
            {geofenceStatus === "checking" ? (
              <Loader2 size={16} className="animate-spin shrink-0 mt-0.5" />
            ) : geofenceStatus === "ok" ? (
              <MapPin size={16} className="shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              {geofenceStatus === "checking" && <p>Checking your location…</p>}
              {geofenceStatus === "ok" && (
                <p>You&apos;re at the school ({Math.round(geofenceDistanceM ?? 0)}m away).</p>
              )}
              {geofenceStatus === "far" && (
                <p>
                  You&apos;re {Math.round(geofenceDistanceM ?? 0)}m from {schoolName} — more than{" "}
                  {GEOFENCE_RADIUS_M}m. Confirm button is disabled unless you override.
                </p>
              )}
              {geofenceStatus === "error" && <p>{geofenceError ?? "Could not check your location."}</p>}
              {geofenceStatus === "no-target" && (
                <p>This school has no saved location, so distance can&apos;t be verified.</p>
              )}
              {geofenceStatus !== "ok" && geofenceStatus !== "checking" && (
                <label className="mt-2 flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideGeofence}
                    onChange={(e) => setOverrideGeofence(e.target.checked)}
                  />
                  Confirm anyway
                </label>
              )}
            </div>
          </div>

          )}

          {/* Origin for mileage — only asked for the first visit of the day;
              every visit after that chains automatically from the previous one. */}
          {!isRemote && chainState.status === "chained" && (
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/40 p-3 text-sm text-gray-600 dark:text-gray-400">
              Starting from your previous visit today: <span className="font-medium">{chainState.label}</span>
            </div>
          )}
          {!isRemote && chainState.status === "needs-input" && (
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                First visit of the day — starting from?
              </p>
              <OriginPicker
                mode={originMode}
                onModeChange={setOriginMode}
                homeAddress={homeAddress}
                onHomeAddressChange={(v) => {
                  setHomeAddress(v);
                  setHomeSaveStatus("idle");
                }}
                onSaveHome={handleSaveHomeAddress}
                homeSaveStatus={homeSaveStatus}
                customAddress={customAddress}
                onCustomAddressChange={setCustomAddress}
                gpsCoords={gpsCoords}
                gpsError={gpsError}
                gpsLoading={geofenceStatus === "checking" && !gpsCoords && !gpsError}
                onRequestGps={() => {}}
                allowGps={!isBackdated}
                office={office}
              />
            </div>
          )}

          {/* Who did you visit */}
          <div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Who did you visit?</p>
            <div className="grid grid-cols-2 gap-2">
              {VISITED_WITH_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={visitedWith.includes(opt.value)}
                    onChange={() => toggleVisitedWith(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Conversation notes — Principal / Main Office / In-school music teacher */}
          {showTalkAbout && (
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">What did you talk about?</p>
              <textarea
                placeholder="Events? Concerts? (school's or YMU's?) Dates?"
                value={principalNotes}
                onChange={(e) => setPrincipalNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
              />
            </div>
          )}

          {/* Teacher observation — YMU teacher */}
          {showTeacherObservation && teacherName && (
            <p className="text-xs text-gray-500 dark:text-gray-400 -mb-2">
              Ratings below are recorded for <span className="font-medium">{teacherName}</span>
              {subjectName ? ` (${subjectName})` : ""}.
            </p>
          )}
          {showTeacherObservation && (
            <TeacherObservationFields
              observations={observations}
              onObservationChange={setObservation}
              notes={obsNotes}
              onNotesChange={setObsNotes}
              skipReason={obsSkipReason}
              onSkipReasonChange={setObsSkipReason}
              skipNotes={obsSkipNotes}
              onSkipNotesChange={setObsSkipNotes}
            />
          )}

          {/* Instrument request */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={hasInstrumentRequest}
                onChange={(e) => setHasInstrumentRequest(e.target.checked)}
              />
              There&apos;s an instrument request or repair needed
            </label>
            {hasInstrumentRequest && (
              <textarea
                placeholder="Details (instrument, quantity, issue)"
                value={instrumentRequestDetails}
                onChange={(e) => setInstrumentRequestDetails(e.target.value)}
                rows={2}
                className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
              />
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}

        </div>

        <div className="p-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canConfirm || submitting}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Confirm Visit
          </button>
        </div>
      </div>
    </div>
  );
}
