"use client";

import { useEffect, useState } from "react";
import { X, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { isToday } from "date-fns";
import {
  confirmVisit,
  getPreviousVisitToday,
  getMyHomeLocation,
  setMyHomeLocation,
  getOfficeLocations,
  getObservationChoices,
} from "@/app/actions";
import { useGeofence } from "./visit/useGeofence";
import GeofenceNotice from "./visit/GeofenceNotice";
import OriginPicker, { type OriginMode } from "./visit/OriginPicker";
import VehiclePicker, { type VehicleType } from "./visit/VehiclePicker";
import TeacherObservationFields, {
  EMPTY_CHOICES,
  entriesToPayload,
  entryLabel,
  newObservationEntry,
  observationProblem,
  type ObservationChoices,
  type ObservationEntry,
  type ObservationSkipReason,
} from "./visit/TeacherObservationFields";

type ChainState =
  | { status: "loading" }
  | { status: "chained"; label: string }
  | { status: "needs-input" };

// Enough to be a sentence, not enough to be a chore. A rating with no evidence
// behind it is an opinion, and it is the RM's own name on it when somebody
// asks about it months later.
const MIN_OBSERVATION_NOTES = 15;

const VISITED_WITH_OPTIONS: { value: string; label: string }[] = [
  { value: "PRINCIPAL", label: "Principal" },
  { value: "MAIN_OFFICE", label: "Main Office" },
  { value: "INSCHOOL_MUSIC_TEACHER", label: "In-school music teacher" },
  { value: "YMU_TEACHER", label: "YMU teacher" },
];

const TALK_ABOUT_TRIGGERS = ["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER"];

export default function ConfirmVisitModal({
  schoolId,
  schoolName,
  visitDate,
  schoolLat,
  schoolLng,
  subjectName,
  subjectId,
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
  /** The programme this slot is — what the ratings below were watching. */
  subjectId?: string;
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

  // A plan item rehydrated by an older build can arrive without coordinates;
  // the hook asks the school's own row first and only falls back to these.
  const {
    status: geofenceStatus,
    distanceM: geofenceDistanceM,
    error: geofenceError,
    coords: gpsCoords,
  } = useGeofence(schoolId, !isBackdated, { lat: schoolLat, lng: schoolLng });
  const gpsError = geofenceStatus === "error" ? geofenceError : null;
  const [overrideGeofence, setOverrideGeofence] = useState(false);

  const [chainState, setChainState] = useState<ChainState>({ status: "loading" });
  const [originMode, setOriginMode] = useState<OriginMode>("home");
  const [homeAddress, setHomeAddress] = useState("");
  const [savedHomeAddress, setSavedHomeAddress] = useState<{ address: string; lat: number; lng: number } | null>(null);
  const [homeSaveStatus, setHomeSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [customAddress, setCustomAddress] = useState("");
  // gpsCoords above is the geofence's own fix; reusing it as a possible
  // mileage origin means the RM is never prompted for GPS twice.
  const [vehicle, setVehicle] = useState<VehicleType>("PERSONAL");
  type Office = Awaited<ReturnType<typeof getOfficeLocations>>[number];
  const [office, setOffice] = useState<Office | null>(null);

  const [visitedWith, setVisitedWith] = useState<string[]>([]);
  const [principalNotes, setPrincipalNotes] = useState("");
  const [hasInstrumentRequest, setHasInstrumentRequest] = useState(false);
  const [instrumentRequestDetails, setInstrumentRequestDetails] = useState("");
  // One block per class watched. The slot this visit was booked against is
  // ticked from the start — it is the class the RM came for — and any other
  // running alongside it is one tap away.
  const [observationEntries, setObservationEntries] = useState<ObservationEntry[]>(() =>
    teacherId || subjectId
      ? [
          {
            ...newObservationEntry(subjectId ?? null, teacherId ?? null),
            // Named from the slot, so the block reads right even before the
            // lists load, or if the calendar no longer offers this pair.
            savedTeacherName: teacherName ?? null,
            savedSubjectName: subjectName ?? null,
          },
        ]
      : []
  );
  const [choices, setChoices] = useState<ObservationChoices>(EMPTY_CHOICES);
  const [choicesLoading, setChoicesLoading] = useState(true);
  const [obsSkipReason, setObsSkipReason] = useState<ObservationSkipReason | null>(null);
  const [obsSkipNotes, setObsSkipNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    getObservationChoices(schoolId, visitDate.toISOString())
      .then(setChoices)
      .catch(() => setChoices(EMPTY_CHOICES))
      .finally(() => setChoicesLoading(false));
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

  const showTalkAbout = visitedWith.some((v) => TALK_ABOUT_TRIGGERS.includes(v));
  const showTeacherObservation = !isRemote && visitedWith.includes("YMU_TEACHER");
  const skippedObs = showTeacherObservation && obsSkipReason !== null;

  // Rating a teacher without writing down what you saw is an opinion with
  // nothing behind it, and it is the RM's own name on it months later when
  // somebody asks why. YMU 2026-09-22: when the visit actually included the
  // YMU teacher, the note is required.
  //
  // Only then. Picking a skip reason already says the rubric was not filled in
  // and why — asking for evidence of an observation that did not happen would
  // just teach people to type a full stop.
  //
  // Per class now: each ticked class goes to its own teacher, so each needs
  // its own line of evidence.
  const needsObsNotes = showTeacherObservation && !skippedObs;
  const missingNotesFor = needsObsNotes
    ? observationEntries.filter((e) => e.notes.trim().length < MIN_OBSERVATION_NOTES)
    : [];
  // Which classes, and whose — checked once the lists have arrived, so the
  // button does not flash disabled while they load.
  const obsProblem =
    needsObsNotes && !choicesLoading ? observationProblem(observationEntries, choices) : null;

  const canConfirm =
    missingNotesFor.length === 0 &&
    !obsProblem &&
    (isRemote ||
      (isBackdated
        ? hasStartingPoint
        : (geofenceStatus === "ok" || overrideGeofence) && hasStartingPoint));

  const toggleVisitedWith = (value: string) => {
    setVisitedWith((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
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
        origin,
        visitedWith,
        principalNotes: showTalkAbout ? principalNotes.trim() || undefined : undefined,
        hasInstrumentRequest,
        instrumentRequestDetails: hasInstrumentRequest ? instrumentRequestDetails.trim() : undefined,
        geofenceDistanceM: isRemote || isBackdated ? undefined : geofenceDistanceM ?? undefined,
        geofenceOverridden: isRemote ? false : isBackdated || geofenceStatus !== "ok",
        // One per class watched. Always sent, even empty: it is what tells the
        // server this is a current client, whose "no class" is final, rather
        // than an older one whose missing programme it should work out. A
        // skipped observation carries a reason instead, never both.
        observations: showTeacherObservation && !skippedObs ? entriesToPayload(observationEntries) : [],
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
            <GeofenceNotice
              status={geofenceStatus}
              distanceM={geofenceDistanceM}
              error={geofenceError}
              schoolName={schoolName}
              override={overrideGeofence}
              onOverrideChange={setOverrideGeofence}
            />
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
          {showTeacherObservation && (
            <TeacherObservationFields
              entries={observationEntries}
              onEntriesChange={setObservationEntries}
              choices={choices}
              loadingChoices={choicesLoading}
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

          {/* Said here rather than left to a greyed-out button. A disabled
              Confirm with no explanation reads as the app being broken, and
              the RM has already filled in a whole rubric by this point. */}
          {obsProblem && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{obsProblem}</p>
          )}
          {missingNotesFor.length > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Add a line about what you saw or heard for{" "}
              {missingNotesFor.map((e) => entryLabel(e, choices)).join(" and ")} before
              confirming. If you did not actually observe the class, pick a reason
              above instead.
            </p>
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
