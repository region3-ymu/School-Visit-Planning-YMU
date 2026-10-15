"use client";

import { useRef } from "react";
import { Plus, X } from "lucide-react";

export type ObservationRating = "NEEDS_SUPPORT" | "DEVELOPING" | "MEETS" | "EXCEEDS";

export type ObservationDomainKey =
  | "obsPlanningPrep"
  | "obsCultureManagement"
  | "obsInstructionMusicianship"
  | "obsEngagementEvidence"
  | "obsProfessionalismGrowth";

export type ObservationSkipReason =
  | "DID_NOT_STAY"
  | "NO_CLASS_TODAY"
  | "CLASS_CANCELLED"
  | "TEACHER_ABSENT"
  | "SCHEDULE_CONFLICT"
  | "OTHER";

export type ObservationState = Record<ObservationDomainKey, ObservationRating | null>;

export const EMPTY_OBSERVATIONS: ObservationState = {
  obsPlanningPrep: null,
  obsCultureManagement: null,
  obsInstructionMusicianship: null,
  obsEngagementEvidence: null,
  obsProfessionalismGrowth: null,
};

export const RATING_OPTIONS: { value: ObservationRating; label: string }[] = [
  { value: "NEEDS_SUPPORT", label: "Needs support" },
  { value: "DEVELOPING", label: "Developing" },
  { value: "MEETS", label: "Meets" },
  { value: "EXCEEDS", label: "Exceeds" },
];

export const OBSERVATION_DOMAINS: { key: ObservationDomainKey; title: string; hint: string }[] = [
  { key: "obsPlanningPrep", title: "Planning & preparation", hint: "Objectives, materials, pacing" },
  { key: "obsCultureManagement", title: "Culture & management", hint: "Routines, relationships, transitions" },
  { key: "obsInstructionMusicianship", title: "Instruction & musicianship", hint: "Modeling, feedback, skill building" },
  { key: "obsEngagementEvidence", title: "Engagement & learning evidence", hint: "Participation, ownership, output" },
  { key: "obsProfessionalismGrowth", title: "Professionalism & growth", hint: "Communication, reliability, reflection" },
];

export const SKIP_REASONS: { value: ObservationSkipReason; label: string }[] = [
  // First, because it is the one where a class actually ran — the rest are all
  // ways of there being nothing to watch.
  { value: "DID_NOT_STAY", label: "Class ran, didn't stay" },
  { value: "NO_CLASS_TODAY", label: "No class today" },
  { value: "CLASS_CANCELLED", label: "Class cancelled" },
  { value: "TEACHER_ABSENT", label: "Teacher absent" },
  { value: "SCHEDULE_CONFLICT", label: "Schedule conflict" },
  { value: "OTHER", label: "Other reason" },
];

/**
 * One class the RM watched, as the form holds it.
 *
 * `key` is the form's own handle for the block (React's key, and what an
 * unticked class is remembered under so ticking it again brings its ratings
 * back). `id` is the saved VisitObservation's, present only when editing — it
 * goes back to the server so the observation keeps its id, which is what
 * YMU-A files the teacher's evaluation under.
 */
export type ObservationEntry = {
  key: string;
  id?: string;
  teacherId: string | null;
  subjectId: string | null;
  ratings: ObservationState;
  notes: string;
  /**
   * Names as saved, for a teacher or programme the current lists no longer
   * offer (moved school, last year's programme) — so an edit still shows who
   * the observation was about instead of a blank.
   */
  savedTeacherName?: string | null;
  savedSubjectName?: string | null;
};

/** A programme and its teacher, as getObservationChoices lists them. */
export type ClassOption = {
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  /** "13:05–14:05", one per slot that day; empty when not on the calendar that day. */
  times: string[];
  ranOnDate: boolean;
};

export type ObservationChoices = {
  classes: ClassOption[];
  teachers: { id: string; name: string; subjectsHere: string[]; teachingOnDate: boolean }[];
  subjects: { id: string; name: string; taughtOnDate: boolean }[];
};

export const EMPTY_CHOICES: ObservationChoices = { classes: [], teachers: [], subjects: [] };

/** What the visit-reading actions return per observation. */
export type SavedObservation = {
  id: string;
  teacherId: string | null;
  teacherName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  ratings: Record<ObservationDomainKey, ObservationRating | null>;
  notes: string | null;
};

const classKey = (subjectId: string | null, teacherId: string | null) =>
  `class:${subjectId ?? ""}|${teacherId ?? ""}`;

let otherCounter = 0;
const nextOtherKey = () => `other:${Date.now()}:${otherCounter++}`;

/** A fresh, unrated entry for a class. */
export function newObservationEntry(subjectId: string | null, teacherId: string | null): ObservationEntry {
  return { key: classKey(subjectId, teacherId), teacherId, subjectId, ratings: EMPTY_OBSERVATIONS, notes: "" };
}

/** A saved observation, back in the form for editing. */
export function entryFromSaved(o: SavedObservation): ObservationEntry {
  return {
    key: `saved:${o.id}`,
    id: o.id,
    teacherId: o.teacherId,
    subjectId: o.subjectId,
    ratings: { ...EMPTY_OBSERVATIONS, ...o.ratings },
    notes: o.notes ?? "",
    savedTeacherName: o.teacherName,
    savedSubjectName: o.subjectName,
  };
}

/** The list as the confirm / log / edit actions take it. */
export function entriesToPayload(entries: ObservationEntry[]) {
  return entries.map((e) => ({
    id: e.id,
    teacherId: e.teacherId,
    subjectId: e.subjectId,
    ...e.ratings,
    notes: e.notes.trim(),
  }));
}

const matches = (e: ObservationEntry, c: ClassOption) =>
  e.teacherId === c.teacherId && e.subjectId === c.subjectId;

/** "Drumline · Yailin Ayala", from whatever of the two is known. */
export function entryLabel(e: ObservationEntry, choices: ObservationChoices): string {
  const subject =
    choices.subjects.find((s) => s.id === e.subjectId)?.name ??
    choices.classes.find((c) => c.subjectId === e.subjectId)?.subjectName ??
    (e.subjectId ? e.savedSubjectName : null) ??
    null;
  const teacher =
    choices.teachers.find((t) => t.id === e.teacherId)?.name ??
    choices.classes.find((c) => c.teacherId === e.teacherId)?.teacherName ??
    (e.teacherId ? e.savedTeacherName : null) ??
    null;
  return [subject, teacher].filter(Boolean).join(" · ") || "Class not recorded";
}

/**
 * What stops the observations being saved, or null.
 *
 * Every class needs its teacher when the school has any on file (#56): the
 * evaluation is shared with that teacher, and "Not recorded" is how 14 of the
 * first 105 observations ended up belonging to nobody. At least one class must
 * be ticked when there are classes to tick, for the same reason. And the same
 * class twice would send one teacher two evaluations for one lesson.
 */
/** Evidence is required for every class observed; the server holds the same line. */
export const MIN_OBSERVATION_NOTES = 15;

export function observationProblem(entries: ObservationEntry[], choices: ObservationChoices): string | null {
  const hasOptions = choices.classes.length > 0 || choices.teachers.length > 0;
  if (entries.length === 0) {
    return hasOptions
      ? "Tick the class you observed — the evaluation is shared with its teacher."
      : "Add the class you observed (Other / not listed).";
  }
  if (choices.teachers.length > 0 && entries.some((e) => !e.teacherId)) {
    return "Choose the teacher for each class you observed — the evaluation is shared with them.";
  }
  const seen = new Set<string>();
  for (const e of entries) {
    const k = classKey(e.subjectId, e.teacherId);
    if (seen.has(k)) return `${entryLabel(e, choices)} is listed twice — remove one.`;
    seen.add(k);
  }
  // Emilio, 2026-10-15: "Yes — I observed it" means at least one domain rated
  // and evidence written, for every class — an evaluation a teacher receives
  // with nothing in it says nothing.
  for (const e of entries) {
    if (!Object.values(e.ratings).some(Boolean)) {
      return `${entryLabel(e, choices)}: rate at least one of the five areas.`;
    }
    if (e.notes.trim().length < MIN_OBSERVATION_NOTES) {
      return `${entryLabel(e, choices)}: write your notes and evidence (at least ${MIN_OBSERVATION_NOTES} characters).`;
    }
  }
  return null;
}

/**
 * The five-domain teacher rubric, once per class watched, plus the escape
 * hatch for when there was no lesson to watch.
 *
 * A blank rubric on its own is ambiguous — it reads the same whether the class
 * was cancelled or the RM just skipped the paperwork. Picking a reason states
 * which, and collapses the rubric the way choosing Online/Phone does, so nobody
 * is asked to rate teaching they never saw.
 *
 * "Yes" then asks which classes. Carol City MS and North Dade run two at the
 * same time in the same building, and the RM watching both could rate only one
 * (Eric Levy, 2026-10-15). Each ticked class gets its own block — its own five
 * ratings and its own notes — because each goes to its own teacher in YMU-A,
 * and neither should see the other's.
 *
 * "Other / not listed" is the old separate teacher and programme pickers, kept
 * for whatever the calendar does not show: a class the sync never saw, a
 * substitute, a programme with no teacher on it. Nothing the single picker
 * allowed has become impossible.
 */
export default function TeacherObservationFields({
  entries,
  onEntriesChange,
  choices,
  loadingChoices = false,
  skipReason,
  onSkipReasonChange,
  skipNotes,
  onSkipNotesChange,
}: {
  entries: ObservationEntry[];
  onEntriesChange: (entries: ObservationEntry[]) => void;
  choices: ObservationChoices;
  loadingChoices?: boolean;
  skipReason: ObservationSkipReason | null;
  onSkipReasonChange: (value: ObservationSkipReason | null) => void;
  skipNotes: string;
  onSkipNotesChange: (value: string) => void;
}) {
  const observed = skipReason === null;
  // An unticked class keeps what was typed into it, so a slipped thumb on a
  // phone does not throw away a paragraph of notes. Ticking it again restores
  // the block exactly, saved id included.
  const unticked = useRef(new Map<string, ObservationEntry>());

  const toggleClass = (c: ClassOption) => {
    const key = classKey(c.subjectId, c.teacherId);
    const existing = entries.filter((e) => matches(e, c));
    if (existing.length) {
      unticked.current.set(key, existing[0]);
      onEntriesChange(entries.filter((e) => !matches(e, c)));
    } else {
      const restored = unticked.current.get(key);
      onEntriesChange([...entries, restored ?? newObservationEntry(c.subjectId, c.teacherId)]);
    }
  };

  const update = (key: string, patch: Partial<ObservationEntry>) =>
    onEntriesChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const setRating = (e: ObservationEntry, domain: ObservationDomainKey, value: ObservationRating) =>
    update(e.key, { ratings: { ...e.ratings, [domain]: e.ratings[domain] === value ? null : value } });

  const addOther = () =>
    onEntriesChange([
      ...entries,
      { key: nextOtherKey(), teacherId: null, subjectId: null, ratings: EMPTY_OBSERVATIONS, notes: "" },
    ]);

  const remove = (key: string) => onEntriesChange(entries.filter((e) => e.key !== key));

  const selectClass =
    "w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div>
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Teacher observation</p>

      <div className="mt-2 mb-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Did you see a class?</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onSkipReasonChange(null)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              observed
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
            }`}
          >
            Yes — I observed it
          </button>
          {SKIP_REASONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSkipReasonChange(opt.value)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                skipReason === opt.value
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!observed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {skipReason === "DID_NOT_STAY"
              ? "No ratings recorded — the class ran, but this visit wasn't for observing it. The visit still counts, and the reason is saved."
              : "No ratings recorded for this visit — there was no lesson to observe. The visit still counts, and the reason is saved."}
          </p>
          <input
            type="text"
            placeholder={
              skipReason === "DID_NOT_STAY"
                ? "What were you there for? (optional)"
                : "Anything to add? (optional)"
            }
            value={skipNotes}
            onChange={(e) => onSkipNotesChange(e.target.value)}
            className="w-full mt-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-white dark:bg-zinc-800 text-sm"
          />
        </div>
      )}

      {observed && (
        <>
          <div className="mb-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Which classes did you observe?</p>
            {loadingChoices && choices.classes.length === 0 ? (
              <p className="text-xs text-gray-400">Loading the day&apos;s classes…</p>
            ) : choices.classes.length === 0 ? (
              <p className="text-xs text-gray-400">
                No classes on the calendar here — add the class you watched below.
              </p>
            ) : (
              <div className="space-y-1.5">
                {choices.classes.map((c) => (
                  <label
                    key={classKey(c.subjectId, c.teacherId)}
                    className="flex items-start gap-2 text-sm px-3 py-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 cursor-pointer text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={entries.some((e) => matches(e, c))}
                      onChange={() => toggleClass(c)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-gray-800 dark:text-gray-100">{c.subjectName}</span>
                      {" — "}
                      {c.teacherName}
                      {c.times.length > 0 && (
                        <span className="block text-xs text-gray-400">{c.times.join(", ")}</span>
                      )}
                      {!c.ranOnDate && (
                        <span className="block text-xs text-gray-400">Not on the calendar that day</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addOther}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <Plus size={12} /> Other / not listed
            </button>
          </div>

          {entries.length > 0 && (
            <p className="text-xs text-gray-400 mb-2">
              For each class: rate at least one area (skip any you didn&apos;t see) and write your evidence.
            </p>
          )}

          <div className="space-y-4">
            {entries.map((entry) => {
              const listed = choices.classes.some((c) => matches(entry, c));
              return (
                <div
                  key={entry.key}
                  className="min-w-0 rounded-lg border border-gray-200 dark:border-zinc-700 p-2.5 sm:p-3 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 min-w-0">
                      {entryLabel(entry, choices)}
                    </p>
                    {!listed && (
                      <button
                        type="button"
                        onClick={() => remove(entry.key)}
                        aria-label="Remove this class"
                        className="text-gray-400 hover:text-gray-600 shrink-0 p-1 -m-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* A class the checklist does not show: pick what is known,
                      the way the separate pickers always allowed. */}
                  {!listed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        aria-label="Program"
                        value={entry.subjectId ?? ""}
                        onChange={(e) => update(entry.key, { subjectId: e.target.value || null })}
                        className={selectClass}
                      >
                        <option value="">Program not recorded</option>
                        {choices.subjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                            {sub.taughtOnDate ? " (ran that day)" : ""}
                          </option>
                        ))}
                        {/* A saved programme no longer taught here still shows. */}
                        {entry.subjectId && !choices.subjects.some((s) => s.id === entry.subjectId) && (
                          <option value={entry.subjectId}>{entry.savedSubjectName ?? "Program no longer listed"}</option>
                        )}
                      </select>
                      <select
                        aria-label="Teacher"
                        value={entry.teacherId ?? ""}
                        onChange={(e) => update(entry.key, { teacherId: e.target.value || null })}
                        className={selectClass}
                      >
                        <option value="">
                          {choices.teachers.length ? "Choose the teacher…" : "Teacher not recorded"}
                        </option>
                        {choices.teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.subjectsHere.length > 0 ? ` — ${t.subjectsHere.join(", ")}` : ""}
                            {t.teachingOnDate ? " (taught that day)" : ""}
                          </option>
                        ))}
                        {entry.teacherId && !choices.teachers.some((t) => t.id === entry.teacherId) && (
                          <option value={entry.teacherId}>{entry.savedTeacherName ?? "Teacher no longer listed"}</option>
                        )}
                      </select>
                    </div>
                  )}

                  {OBSERVATION_DOMAINS.map((domain) => (
                    <div key={domain.key}>
                      {/* Hint under the title: side by side, a long hint
                          ("Routines, relationships, transitions") pushed the
                          row past the card's edge on a phone. */}
                      <div className="mb-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{domain.title}</p>
                        <p className="text-[11px] text-gray-400">{domain.hint}</p>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {RATING_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setRating(entry, domain.key, opt.value)}
                            className={`min-w-0 px-1.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                              entry.ratings[domain.key] === opt.value
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
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Your notes and evidence <span className="text-red-500">*</span>
                    </p>
                    <textarea
                      placeholder="What did you see or hear that supports these ratings?"
                      value={entry.notes}
                      onChange={(e) => update(entry.key, { notes: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
