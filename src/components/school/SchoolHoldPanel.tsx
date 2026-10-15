"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, PauseCircle } from "lucide-react";
import { snoozeHoldSuggestion } from "@/app/actions";
import SchoolStatusControl from "./SchoolStatusControl";

type OnHold = { id: string; name: string; reason: string | null; sinceKey: string | null; hasClassesAgain: boolean; canChange: boolean };
type Suggestion = { id: string; name: string; canChange: boolean };

/**
 * #64 on the dashboard: the schools on hold (with a nudge when classes are on
 * the calendar again), and the active ones with no class for weeks — offered
 * as a hold for someone to confirm, never put on hold automatically.
 */
export default function SchoolHoldPanel({
  onHold,
  suggestions,
  weeks,
  onChanged,
}: {
  onHold: OnHold[];
  suggestions: Suggestion[];
  weeks: { back: number; ahead: number };
  onChanged: () => void;
}) {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  if (onHold.length === 0 && suggestions.length === 0) return null;
  const shown = showAllSuggestions ? suggestions : suggestions.slice(0, 8);

  return (
    <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {suggestions.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
          <h3 className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
            <CalendarClock size={16} className="text-amber-600 dark:text-amber-400" />
            Put on hold? ({suggestions.length})
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            No class on the calendar in the last {weeks.back} weeks or the next {weeks.ahead}. On hold, they stop
            being planned and counted as never visited or overdue.
          </p>
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-zinc-800">
            {shown.map((s) => (
              <li key={s.id} className="py-2 grid gap-1.5">
                <Link href={`/schools/${s.id}`} className="text-sm font-medium text-gray-800 dark:text-gray-100 hover:text-indigo-600">
                  {s.name}
                </Link>
                {s.canChange && (
                  <div className="flex flex-wrap items-start gap-2">
                    <SchoolStatusControl
                      schoolId={s.id}
                      status="ACTIVE"
                      defaultReason="No classes on the calendar"
                      onChanged={onChanged}
                      compact
                    />
                    <button
                      type="button"
                      onClick={() => snoozeHoldSuggestion(s.id).then(onChanged)}
                      className="rounded-lg border border-gray-200 dark:border-zinc-700 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
                      title="Hide this suggestion for 30 days"
                    >
                      Not now
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {suggestions.length > shown.length && (
            <button
              type="button"
              onClick={() => setShowAllSuggestions(true)}
              className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Show all {suggestions.length}
            </button>
          )}
        </div>
      )}

      {onHold.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
          <h3 className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
            <PauseCircle size={16} className="text-gray-500" />
            Schools on hold ({onHold.length})
          </h3>
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-zinc-800">
            {onHold.map((s) => (
              <li key={s.id} className="py-2 grid gap-1">
                <Link href={`/schools/${s.id}`} className="text-sm font-medium text-gray-800 dark:text-gray-100 hover:text-indigo-600">
                  {s.name}
                </Link>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {[s.reason, s.sinceKey && `since ${s.sinceKey}`].filter(Boolean).join(" · ") || "On hold"}
                </p>
                {s.hasClassesAgain && (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Classes are on the calendar again — resume it?
                  </p>
                )}
                {s.canChange && (
                  <SchoolStatusControl schoolId={s.id} status="ON_HOLD" onChanged={onChanged} compact />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
