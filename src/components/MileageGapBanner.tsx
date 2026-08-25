"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { getMileageGaps, retryMileageGaps, type MileageGap } from "@/app/actions";

/**
 * The loud half of the mileage-gap safeguard (getMileageGaps in actions.ts is
 * the quiet half).
 *
 * Mileage is calculated best-effort so that a routing-service outage cannot
 * cost an RM the visit itself — but the previous behaviour was for those miles
 * to vanish without a word: the report simply omits a visit with no measured
 * leg, so nothing on any screen said that a drive had gone unrecorded. An RM
 * would only find out at reimbursement time, by which point remembering the
 * trip is the only recourse.
 *
 * So it shouts. Red, above everything, on every tab, until there is nothing
 * left to fix. Nothing about it is dismissible: a banner that can be waved away
 * is a banner that gets waved away, and this one is about money that was
 * actually spent.
 */
export default function MileageGapBanner() {
  const [gaps, setGaps] = useState<MileageGap[] | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGaps(await getMileageGaps());
    } catch {
      // Never let this take the app down with it — it is a safety net, not a
      // feature. If it cannot load, the rest of the page still works.
      setGaps([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = async () => {
    setRetrying(true);
    setResult(null);
    try {
      const { fixed, remaining } = await retryMileageGaps();
      setResult(
        fixed === 0
          ? "Still couldn't reach the routing service. Try again in a few minutes."
          : `Recovered mileage for ${fixed} visit${fixed === 1 ? "" : "s"}.${
              remaining > 0 ? ` ${remaining} still need a starting point.` : ""
            }`
      );
      await load();
    } catch {
      setResult("Recalculation failed. Try again in a few minutes.");
    } finally {
      setRetrying(false);
    }
  };

  if (!gaps || gaps.length === 0) return null;

  const retryable = gaps.filter((g) => g.retryable);
  const needsOrigin = gaps.filter((g) => !g.retryable);

  return (
    <div
      role="alert"
      className="m-4 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={24} className="shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-black text-red-700 dark:text-red-300">
            {gaps.length} visit{gaps.length === 1 ? "" : "s"} {gaps.length === 1 ? "has" : "have"} no
            mileage recorded
          </h2>
          <p className="mt-0.5 text-sm text-red-700/90 dark:text-red-300/90">
            {retryable.length > 0
              ? "The routing service didn't answer when these were confirmed, so the miles were never measured. They are missing from your mileage report until this is fixed."
              : "No starting point was recorded for these, so the distance can't be worked out on its own."}
          </p>

          <ul className="mt-2 space-y-0.5 text-sm text-red-800 dark:text-red-200">
            {gaps.slice(0, 6).map((g) => (
              <li key={g.id}>
                <span className="font-semibold">{format(new Date(g.date), "EEE d MMM")}</span>{" "}
                — {g.schoolName}
                {g.retryable ? (
                  <span className="text-red-600/80 dark:text-red-400/80">
                    {" "}
                    (from {g.originLabel ?? "a recorded start"})
                  </span>
                ) : (
                  <span className="text-red-600/80 dark:text-red-400/80"> (no starting point)</span>
                )}
              </li>
            ))}
            {gaps.length > 6 && <li className="italic">…and {gaps.length - 6} more</li>}
          </ul>

          {needsOrigin.length > 0 && retryable.length > 0 && (
            <p className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
              {needsOrigin.length} of these {needsOrigin.length === 1 ? "has" : "have"} no starting
              point recorded and can&apos;t be recalculated automatically.
            </p>
          )}

          {needsOrigin.length > 0 && (
            <p className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
              To fix those, open the day in <span className="font-semibold">Visit History</span> and
              save the trip again — that recomputes the day from where it actually started.
            </p>
          )}

          {result && (
            <p className="mt-2 text-sm font-semibold text-red-800 dark:text-red-200">{result}</p>
          )}

          {retryable.length > 0 && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {retrying ? "Recalculating…" : `Recalculate ${retryable.length} visit${retryable.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
