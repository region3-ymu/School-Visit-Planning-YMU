"use client";

export type ObservationRating = "NEEDS_SUPPORT" | "DEVELOPING" | "MEETS" | "EXCEEDS";

export type ObservationDomainKey =
  | "obsPlanningPrep"
  | "obsCultureManagement"
  | "obsInstructionMusicianship"
  | "obsEngagementEvidence"
  | "obsProfessionalismGrowth";

export type ObservationSkipReason =
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

const SKIP_REASONS: { value: ObservationSkipReason; label: string }[] = [
  { value: "NO_CLASS_TODAY", label: "No class today" },
  { value: "CLASS_CANCELLED", label: "Class cancelled" },
  { value: "TEACHER_ABSENT", label: "Teacher absent" },
  { value: "SCHEDULE_CONFLICT", label: "Schedule conflict" },
  { value: "OTHER", label: "Other reason" },
];

/**
 * The five-domain teacher rubric, plus the escape hatch for when there was no
 * lesson to watch.
 *
 * A blank rubric on its own is ambiguous — it reads the same whether the class
 * was cancelled or the RM just skipped the paperwork. Picking a reason states
 * which, and collapses the rubric the way choosing Online/Phone does, so nobody
 * is asked to rate teaching they never saw.
 */
export default function TeacherObservationFields({
  observations,
  onObservationChange,
  notes,
  onNotesChange,
  skipReason,
  onSkipReasonChange,
  skipNotes,
  onSkipNotesChange,
}: {
  observations: ObservationState;
  onObservationChange: (key: ObservationDomainKey, value: ObservationRating) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  skipReason: ObservationSkipReason | null;
  onSkipReasonChange: (value: ObservationSkipReason | null) => void;
  skipNotes: string;
  onSkipNotesChange: (value: string) => void;
}) {
  const observed = skipReason === null;

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
            No ratings recorded for this visit — there was no lesson to observe. The visit still
            counts, and the reason is saved.
          </p>
          <input
            type="text"
            placeholder="Anything to add? (optional)"
            value={skipNotes}
            onChange={(e) => onSkipNotesChange(e.target.value)}
            className="w-full mt-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-white dark:bg-zinc-800 text-sm"
          />
        </div>
      )}

      {observed && (
        <>
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
                      onClick={() => onObservationChange(domain.key, opt.value)}
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
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            />
          </div>
        </>
      )}
    </div>
  );
}
