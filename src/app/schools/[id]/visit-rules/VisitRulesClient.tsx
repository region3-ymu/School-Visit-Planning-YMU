"use client";

import { useState, useTransition } from "react";
import {
  getVisitRulesForSchool,
  createVisitRule,
  archiveVisitRule,
  updateVisitRule,
} from "@/app/actions";
import { format } from "date-fns";
import { Settings, Plus, Archive, Edit2, Check } from "lucide-react";

type VisitRule = Awaited<ReturnType<typeof getVisitRulesForSchool>>[number];

const FREQUENCY_OPTIONS = [
  {
    value: "WEEKLY" as const,
    label: "Weekly",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    description: "Urgent — visit every week",
  },
  {
    value: "BIWEEKLY" as const,
    label: "Every 2 weeks",
    badge: "bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300",
    description: "Default — standard cadence",
  },
  {
    value: "EVERY_3_WEEKS" as const,
    label: "Every 3 weeks",
    badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    description: "Running well",
  },
  {
    value: "MONTHLY" as const,
    label: "Monthly",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    description: "Very stable — monthly check-in",
  },
];

export function FrequencyBadge({ freq }: { freq: string }) {
  const opt = FREQUENCY_OPTIONS.find((o) => o.value === freq);
  if (!opt) return <span className="text-xs text-gray-400">{freq}</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${opt.badge}`}>
      {opt.label}
    </span>
  );
}

function RuleForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Partial<VisitRule>;
  onSave: (data: { frequencyType: string; reason?: string; effectiveFrom?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [freq, setFreq] = useState<string>(initial?.frequencyType ?? "BIWEEKLY");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(
    initial?.effectiveFrom
      ? format(new Date(initial.effectiveFrom), "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd")
  );

  return (
    <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-4">
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Visit Frequency
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FREQUENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFreq(opt.value)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                freq === opt.value
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-600"
                  : "border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-gray-300 dark:hover:border-zinc-600"
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                {freq === opt.value && (
                  <Check size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                )}
                <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                  {opt.label}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 pl-4">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Reason for override{" "}
          <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="e.g. Admin issue, new director onboarding, running smoothly"
          className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Effective from
        </label>
        <input
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onSave({ frequencyType: freq, reason: reason || undefined, effectiveFrom })
          }
          disabled={isPending}
          className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save Rule"}
        </button>
      </div>
    </div>
  );
}

export default function VisitRulesClient({
  schoolId,
  schoolName,
  initialRules,
}: {
  schoolId: string;
  schoolName: string;
  initialRules: VisitRule[];
}) {
  const [rules, setRules] = useState<VisitRule[]>(initialRules);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const r = await getVisitRulesForSchool(schoolId);
    setRules(r);
  };

  const handleCreate = (data: { frequencyType: string; reason?: string; effectiveFrom?: string }) => {
    startTransition(async () => {
      await createVisitRule(schoolId, data);
      setShowCreateForm(false);
      await refresh();
    });
  };

  const handleUpdate = (
    ruleId: string,
    data: { frequencyType: string; reason?: string; effectiveFrom?: string }
  ) => {
    startTransition(async () => {
      await updateVisitRule(ruleId, data);
      setEditingId(null);
      await refresh();
    });
  };

  const handleArchive = (ruleId: string) => {
    if (!confirm("Archive this rule? The school will revert to the default 2-week cadence.")) return;
    startTransition(async () => {
      await archiveVisitRule(ruleId);
      await refresh();
    });
  };

  const activeRules = rules.filter((r) => !r.effectiveTo);
  const pastRules = rules.filter((r) => r.effectiveTo);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings size={20} className="text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Visit Rules</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {schoolName} — override how often this school is visited
          </p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => {
              setShowCreateForm(true);
              setEditingId(null);
            }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New Rule
          </button>
        )}
      </div>

      {showCreateForm && (
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-2">
            New override rule
          </p>
          <RuleForm
            onSave={handleCreate}
            onCancel={() => setShowCreateForm(false)}
            isPending={isPending}
          />
        </div>
      )}

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
          Active Rule
        </h2>
        {activeRules.length === 0 ? (
          <div className="border border-dashed border-gray-200 dark:border-zinc-700 rounded-xl p-4 text-sm text-gray-500 dark:text-gray-400">
            No override — using default <strong>Every 2 weeks</strong> cadence.
            <br />
            <span className="text-xs mt-1 block text-gray-400">
              Create a rule above to change the visit frequency for this school.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {activeRules.map((rule) =>
              editingId === rule.id ? (
                <RuleForm
                  key={rule.id}
                  initial={rule}
                  onSave={(data) => handleUpdate(rule.id, data)}
                  onCancel={() => setEditingId(null)}
                  isPending={isPending}
                />
              ) : (
                <div
                  key={rule.id}
                  className="border border-gray-200 dark:border-zinc-700 rounded-xl p-4 bg-gray-50/50 dark:bg-zinc-800/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <FrequencyBadge freq={rule.frequencyType} />
                      {rule.reason && (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          &ldquo;{rule.reason}&rdquo;
                        </p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Active since{" "}
                        {rule.effectiveFrom
                          ? format(new Date(rule.effectiveFrom), "MMM d, yyyy")
                          : format(new Date(rule.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setEditingId(rule.id);
                          setShowCreateForm(false);
                        }}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleArchive(rule.id)}
                        disabled={isPending}
                        className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
                        title="Archive — revert to default cadence"
                      >
                        <Archive size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {pastRules.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
            Past Rules
          </h2>
          <div className="space-y-2">
            {pastRules.map((rule) => (
              <div
                key={rule.id}
                className="border border-gray-100 dark:border-zinc-800 rounded-xl p-3 opacity-60 flex items-center gap-3"
              >
                <FrequencyBadge freq={rule.frequencyType} />
                {rule.reason && (
                  <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    &ldquo;{rule.reason}&rdquo;
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto shrink-0">
                  {rule.effectiveFrom
                    ? format(new Date(rule.effectiveFrom), "MMM d")
                    : format(new Date(rule.createdAt), "MMM d")}{" "}
                  →{" "}
                  {rule.effectiveTo ? format(new Date(rule.effectiveTo), "MMM d, yyyy") : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
