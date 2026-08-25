"use client";

import { Building2, Car, MapPin, Music, Truck, User } from "lucide-react";
import {
  OBSERVATION_DOMAINS,
  RATING_OPTIONS,
  SKIP_REASONS,
  type ObservationRating,
  type ObservationSkipReason,
} from "./TeacherObservationFields";

const VISITED_WITH_LABELS: Record<string, string> = {
  PRINCIPAL: "Principal",
  MAIN_OFFICE: "Main Office",
  INSCHOOL_MUSIC_TEACHER: "In-school music teacher",
  YMU_TEACHER: "YMU teacher",
};

const MODE_LABELS: Record<string, string> = {
  IN_PERSON: "In person",
  ONLINE: "Online",
  PHONE: "Phone call",
};

const ratingLabel = (r: ObservationRating) =>
  RATING_OPTIONS.find((o) => o.value === r)?.label ?? r;

const skipLabel = (r: ObservationSkipReason) =>
  SKIP_REASONS.find((o) => o.value === r)?.label ?? r;

/** Ratings run worst to best, so the colour should too. */
const RATING_TONE: Record<ObservationRating, string> = {
  NEEDS_SUPPORT: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  DEVELOPING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MEETS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  EXCEEDS: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{title}</p>
      {children}
    </div>
  );
}

export type VisitDetailsData = {
  mode: string;
  vehicle: string;
  milesDriven: number | null;
  returnMilesDriven: number | null;
  commuteMiles: number | null;
  returnCommuteMiles: number | null;
  originLabel: string | null;
  visitedWith: string[];
  principalNotes: string | null;
  observations: Record<string, ObservationRating | null>;
  obsNotes: string | null;
  obsSkipReason: ObservationSkipReason | null;
  obsSkipNotes: string | null;
  hasInstrumentRequest: boolean;
  instrumentRequestDetails: string | null;
  geofenceOverridden: boolean;
  visitedByName: string | null;
  observedTeacherName?: string | null;
};

/**
 * Everything the visit form recorded, for one visit.
 *
 * All of this was being written and none of it read back, so a conversation
 * with a principal or a teacher's ratings went in and were never seen again.
 */
export default function VisitDetails({ visit }: { visit: VisitDetailsData }) {
  const rated = OBSERVATION_DOMAINS.filter((d) => visit.observations[d.key]);
  const driven = (visit.milesDriven ?? 0) + (visit.returnMilesDriven ?? 0);
  const commute = (visit.commuteMiles ?? 0) + (visit.returnCommuteMiles ?? 0);
  const isVan = visit.vehicle === "YMU_VAN";
  const payable = isVan ? 0 : Math.max(0, driven - commute);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 bg-gray-50 dark:bg-zinc-800/30 border-t border-gray-100 dark:border-zinc-800">
      <Section title="Visit">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span className="inline-flex items-center gap-1.5">
            {isVan ? <Truck size={14} /> : <Car size={14} />}
            {MODE_LABELS[visit.mode] ?? visit.mode}
            {visit.mode === "IN_PERSON" && (isVan ? " · YMU van" : " · own car")}
          </span>
          {visit.visitedByName && (
            <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <User size={14} /> {visit.visitedByName}
            </span>
          )}
        </div>
        {visit.mode === "IN_PERSON" && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            {driven > 0 ? (
              <>
                {driven.toFixed(1)} mi driven
                {visit.originLabel && ` from ${visit.originLabel}`}
                {commute > 0 && ` · ${commute.toFixed(1)} commute`}
                {` · ${payable.toFixed(1)} reimbursable`}
              </>
            ) : (
              "No mileage recorded."
            )}
          </p>
        )}
        {visit.geofenceOverridden && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 inline-flex items-center gap-1">
            <MapPin size={12} /> Location not verified
          </p>
        )}
      </Section>

      <Section title="Who was seen">
        {visit.visitedWith.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {visit.visitedWith.map((w) => (
              <span
                key={w}
                className="inline-flex items-center px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {VISITED_WITH_LABELS[w] ?? w}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Not recorded.</p>
        )}
      </Section>

      {visit.principalNotes && (
        <Section title="What was discussed">
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{visit.principalNotes}</p>
        </Section>
      )}

      {visit.hasInstrumentRequest && (
        <Section title="Instrument request">
          <p className="text-sm text-gray-700 dark:text-gray-300 inline-flex items-start gap-1.5">
            <Music size={14} className="shrink-0 mt-0.5 text-indigo-500" />
            <span className="whitespace-pre-wrap">{visit.instrumentRequestDetails || "No details given."}</span>
          </p>
        </Section>
      )}

      {(rated.length > 0 || visit.obsSkipReason) && (
        <div className="md:col-span-2">
          <Section title={visit.observedTeacherName ? `Teacher observation — ${visit.observedTeacherName}` : "Teacher observation"}>
            {visit.obsSkipReason ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Not evaluated — {skipLabel(visit.obsSkipReason).toLowerCase()}
                {visit.obsSkipNotes && (
                  <span className="text-gray-600 dark:text-gray-400"> · {visit.obsSkipNotes}</span>
                )}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {rated.map((d) => {
                    const r = visit.observations[d.key] as ObservationRating;
                    return (
                      <div key={d.key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-700 dark:text-gray-300">{d.title}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${RATING_TONE[r]}`}>
                          {ratingLabel(r)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {rated.length < OBSERVATION_DOMAINS.length && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    {OBSERVATION_DOMAINS.length - rated.length} domain
                    {OBSERVATION_DOMAINS.length - rated.length === 1 ? "" : "s"} not rated this visit.
                  </p>
                )}
                {visit.obsNotes && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 whitespace-pre-wrap">{visit.obsNotes}</p>
                )}
              </>
            )}
          </Section>
        </div>
      )}

      {visit.mode !== "IN_PERSON" && (
        <p className="md:col-span-2 text-xs text-gray-400 inline-flex items-center gap-1.5">
          <Building2 size={12} /> Remote visit — no mileage or classroom observation.
        </p>
      )}
    </div>
  );
}
