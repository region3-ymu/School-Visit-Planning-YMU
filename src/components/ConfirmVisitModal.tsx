"use client";

import { useEffect, useState } from "react";
import { X, MapPin, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { confirmVisit, getPreviousVisitToday, getMyHomeLocation, setMyHomeLocation } from "@/app/actions";
import { haversineMeters } from "@/lib/geo";

type OriginMode = "home" | "custom";
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

type ObservationRating = "NEEDS_SUPPORT" | "DEVELOPING" | "MEETS" | "EXCEEDS";
type ObservationDomainKey =
  | "obsPlanningPrep"
  | "obsCultureManagement"
  | "obsInstructionMusicianship"
  | "obsEngagementEvidence"
  | "obsProfessionalismGrowth";

const RATING_OPTIONS: { value: ObservationRating; label: string }[] = [
  { value: "NEEDS_SUPPORT", label: "Needs support" },
  { value: "DEVELOPING", label: "Developing" },
  { value: "MEETS", label: "Meets" },
  { value: "EXCEEDS", label: "Exceeds" },
];

const OBSERVATION_DOMAINS: { key: ObservationDomainKey; title: string; hint: string }[] = [
  { key: "obsPlanningPrep", title: "Planning & preparation", hint: "Objectives, materials, pacing" },
  { key: "obsCultureManagement", title: "Culture & management", hint: "Routines, relationships, transitions" },
  { key: "obsInstructionMusicianship", title: "Instruction & musicianship", hint: "Modeling, feedback, skill building" },
  { key: "obsEngagementEvidence", title: "Engagement & learning evidence", hint: "Participation, ownership, output" },
  { key: "obsProfessionalismGrowth", title: "Professionalism & growth", hint: "Communication, reliability, reflection" },
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
  onClose,
  onConfirmed,
}: {
  schoolId: string;
  schoolName: string;
  visitDate: Date;
  schoolLat?: number;
  schoolLng?: number;
  subjectName?: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
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

  const [visitedWith, setVisitedWith] = useState<string[]>([]);
  const [principalNotes, setPrincipalNotes] = useState("");
  const [hasInstrumentRequest, setHasInstrumentRequest] = useState(false);
  const [instrumentRequestDetails, setInstrumentRequestDetails] = useState("");
  const [observations, setObservations] = useState<Record<ObservationDomainKey, ObservationRating | null>>({
    obsPlanningPrep: null,
    obsCultureManagement: null,
    obsInstructionMusicianship: null,
    obsEngagementEvidence: null,
    obsProfessionalismGrowth: null,
  });
  const [obsNotes, setObsNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeofenceStatus("error");
      setGeofenceError("Geolocation is not supported by this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (schoolLat == null || schoolLng == null) {
          setGeofenceStatus("no-target");
          return;
        }
        const distance = haversineMeters(pos.coords.latitude, pos.coords.longitude, schoolLat, schoolLng);
        setGeofenceDistanceM(distance);
        setGeofenceStatus(distance <= GEOFENCE_RADIUS_M ? "ok" : "far");
      },
      (err) => {
        setGeofenceStatus("error");
        setGeofenceError(err.message || "Could not get GPS location");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [schoolLat, schoolLng]);

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

  const canConfirm =
    (geofenceStatus === "ok" || overrideGeofence) &&
    (chainState.status !== "needs-input" ||
      (originMode === "home" ? !!homeAddress.trim() : !!customAddress.trim()));

  const toggleVisitedWith = (value: string) => {
    setVisitedWith((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const showTalkAbout = visitedWith.some((v) => TALK_ABOUT_TRIGGERS.includes(v));
  const showTeacherObservation = visitedWith.includes("YMU_TEACHER");

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
      let origin: { lat: number; lng: number; label?: string } | undefined;

      if (chainState.status === "needs-input") {
        if (originMode === "home" && savedHomeAddress && homeAddress.trim() === savedHomeAddress.address) {
          origin = { lat: savedHomeAddress.lat, lng: savedHomeAddress.lng, label: "Home" };
        } else {
          const addressToGeocode = originMode === "home" ? homeAddress.trim() : customAddress.trim();
          const res = await fetch("/api/routing/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: addressToGeocode }),
          });
          const geo = await res.json();
          if (!res.ok) throw new Error(geo.error ?? "Could not find that address");
          origin = { lat: geo.lat, lng: geo.lng, label: originMode === "home" ? "Home" : geo.label };
        }
      }

      await confirmVisit(schoolId, visitDate.toISOString(), {
        origin,
        visitedWith,
        principalNotes: showTalkAbout ? principalNotes.trim() || undefined : undefined,
        hasInstrumentRequest,
        instrumentRequestDetails: hasInstrumentRequest ? instrumentRequestDetails.trim() : undefined,
        geofenceDistanceM: geofenceDistanceM ?? undefined,
        geofenceOverridden: geofenceStatus !== "ok",
        obsPlanningPrep: observations.obsPlanningPrep ?? undefined,
        obsCultureManagement: observations.obsCultureManagement ?? undefined,
        obsInstructionMusicianship: observations.obsInstructionMusicianship ?? undefined,
        obsEngagementEvidence: observations.obsEngagementEvidence ?? undefined,
        obsProfessionalismGrowth: observations.obsProfessionalismGrowth ?? undefined,
        obsNotes: showTeacherObservation ? obsNotes.trim() || undefined : undefined,
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] flex flex-col">
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
          {/* Geofence status */}
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

          {/* Origin for mileage — only asked for the first visit of the day;
              every visit after that chains automatically from the previous one. */}
          {chainState.status === "chained" && (
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/40 p-3 text-sm text-gray-600 dark:text-gray-400">
              Starting from your previous visit today: <span className="font-medium">{chainState.label}</span>
            </div>
          )}
          {chainState.status === "needs-input" && (
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                First visit of the day — starting from?
              </p>
              <div className="flex gap-2 mb-2">
                {(
                  [
                    { mode: "home" as const, label: "Home" },
                    { mode: "custom" as const, label: "Custom address" },
                  ] as const
                ).map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setOriginMode(mode)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      originMode === mode
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                        : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {originMode === "home" && (
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Your home address"
                      value={homeAddress}
                      onChange={(e) => {
                        setHomeAddress(e.target.value);
                        setHomeSaveStatus("idle");
                      }}
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleSaveHomeAddress}
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
              {originMode === "custom" && (
                <input
                  type="text"
                  placeholder="Enter address"
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                />
              )}
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
          {showTeacherObservation && (
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Teacher observation</p>
              <p className="text-xs text-gray-400 mb-3">Skip a domain if you didn&apos;t see it this visit.</p>
              <div className="space-y-3">
                {OBSERVATION_DOMAINS.map((domain) => (
                  <div key={domain.key}>
                    <div className="flex justify-between items-baseline mb-1 gap-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{domain.title}</span>
                      <span className="text-[11px] text-gray-400 text-right shrink-0">{domain.hint}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {RATING_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setObservation(domain.key, opt.value)}
                          className={`px-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                            observations[domain.key] === opt.value
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Your notes and evidence</p>
                <textarea
                  placeholder="What did you see or hear that supports these ratings?"
                  value={obsNotes}
                  onChange={(e) => setObsNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                />
              </div>
            </div>
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
