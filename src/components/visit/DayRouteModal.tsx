"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Route, X } from "lucide-react";
import { getDayRoute, reorderDayVisits } from "@/app/actions";

type Stop = Awaited<ReturnType<typeof getDayRoute>>[number];

/**
 * Reorders one day's stops and reprices the day.
 *
 * Mileage chains each stop from the one before it, so a stop remembered in the
 * wrong order leaves every leg after it measured from the wrong school. Before
 * this the only fix was deleting the day and retyping every note, so this exists
 * to make a misremembered route repairable.
 */
export default function DayRouteModal({
  dateIso,
  dateLabel,
  onClose,
  onSaved,
}: {
  dateIso: string;
  dateLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDayRoute(dateIso).then(setStops).catch((e) => setError(e.message));
  }, [dateIso]);

  const move = (from: number, to: number) => {
    if (!stops || to < 0 || to >= stops.length) return;
    const next = [...stops];
    [next[from], next[to]] = [next[to], next[from]];
    setStops(next);
  };

  const original = stops?.map((s) => s.id).join(",");
  const [baseline, setBaseline] = useState<string | null>(null);
  useEffect(() => {
    if (stops && baseline === null) setBaseline(stops.map((s) => s.id).join(","));
  }, [stops, baseline]);
  const changed = baseline !== null && original !== baseline;

  const handleSave = async () => {
    if (!stops) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await reorderDayVisits(dateIso, stops.map((s) => s.id));
      setStops(updated);
      setBaseline(updated.map((s) => s.id).join(","));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the new order");
    } finally {
      setSaving(false);
    }
  };

  const totals = (stops ?? []).reduce(
    (acc, s) => {
      acc.driven += s.milesDriven ?? 0;
      acc.commute += s.commuteMiles ?? 0;
      return acc;
    },
    { driven: 0, commute: 0 }
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-xl shadow-xl overflow-hidden border border-gray-100 dark:border-zinc-800 max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Route size={18} className="text-indigo-600 dark:text-indigo-400" />
            Route for {dateLabel}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Put the stops in the order you actually drove them. Saving reprices every leg from the
            stop in front of it; the day still starts where it started.
          </p>

          {!stops && !error && (
            <p className="text-sm text-gray-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading the day…
            </p>
          )}

          {stops?.length === 0 && <p className="text-sm text-gray-500">No visits logged that day.</p>}

          {stops?.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-zinc-700 p-3"
            >
              <span className="w-6 h-6 shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{s.schoolName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {s.mode === "IN_PERSON"
                    ? s.milesDriven != null
                      ? `${s.milesDriven.toFixed(1)} mi from ${s.originLabel ?? "—"}${s.commuteMiles ? " · commute" : ""}`
                      : "No mileage"
                    : "Remote — no driving"}
                </p>
              </div>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-25"
                  aria-label="Move earlier"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={i === stops.length - 1}
                  className="p-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-25"
                  aria-label="Move later"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
          ))}

          {stops && stops.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {totals.driven.toFixed(1)} mi driven
              {totals.commute > 0 && ` − ${totals.commute.toFixed(1)} commute`} ={" "}
              <span className="font-semibold text-gray-700 dark:text-gray-300">
                {Math.max(0, totals.driven - totals.commute).toFixed(1)} reimbursable
              </span>
              {changed && <span className="text-amber-600 dark:text-amber-400"> · not saved yet</span>}
            </p>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="p-4 bg-gray-50 dark:bg-zinc-800/50 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !changed}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save order & reprice
          </button>
        </div>
      </div>
    </div>
  );
}
