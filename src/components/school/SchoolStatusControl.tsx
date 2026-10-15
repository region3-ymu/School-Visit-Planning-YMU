"use client";

import { useState } from "react";
import { PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { setSchoolStatus } from "@/app/actions";

export type SchoolStatus = "ACTIVE" | "ON_HOLD" | "INACTIVE";

export const STATUS_LABEL: Record<SchoolStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  INACTIVE: "Inactive",
};

/** The small grey/red pill next to a school's name. Nothing for ACTIVE. */
export function SchoolStatusBadge({ status }: { status: SchoolStatus | string | null | undefined }) {
  if (status === "ON_HOLD") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 dark:bg-zinc-700 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
        <PauseCircle size={11} /> On hold
      </span>
    );
  }
  if (status === "INACTIVE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300">
        <XCircle size={11} /> Inactive
      </span>
    );
  }
  return null;
}

/**
 * #64: put a school on hold (ours, no classes yet), mark it inactive (we no
 * longer work there, or it closed), or bring it back. The server checks who
 * may (Admin, Operations, the region's RM); this only hides the buttons from
 * everyone else.
 */
export default function SchoolStatusControl({
  schoolId,
  status,
  defaultReason,
  onChanged,
  compact = false,
}: {
  schoolId: string;
  status: SchoolStatus;
  /** Prefilled reason, e.g. from a "no classes for weeks" suggestion. */
  defaultReason?: string;
  onChanged: (status: SchoolStatus) => void;
  compact?: boolean;
}) {
  const [asking, setAsking] = useState<SchoolStatus | null>(null);
  const [reason, setReason] = useState(defaultReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: SchoolStatus) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setSchoolStatus({ schoolId, status: next, reason });
      if (!result.ok) setError(result.error);
      else {
        setAsking(null);
        onChanged(next);
      }
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const button =
    "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50";

  if (asking) {
    return (
      <div className="grid gap-2 rounded-lg border border-gray-200 dark:border-zinc-700 p-2 text-xs">
        <p className="font-medium text-gray-700 dark:text-gray-200">
          {asking === "ON_HOLD"
            ? "On hold: not planned, not counted, no \"Never visited\". You can still log a visit here."
            : "Inactive: we no longer work here, or it closed. Hidden everywhere except visit history."}
        </p>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={asking === "ON_HOLD" ? "Why? e.g. No classes yet" : "Why? e.g. School closed"}
          className="w-full rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => apply(asking)}
            className={`${button} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`}
          >
            {busy ? "Saving…" : asking === "ON_HOLD" ? "Put on hold" : "Mark inactive"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAsking(null)}
            className={`${button} border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800`}
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "mt-3"}`}>
      {status !== "ACTIVE" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => apply("ACTIVE")}
          className={`${button} border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/30`}
        >
          <PlayCircle size={13} /> {status === "ON_HOLD" ? "Resume" : "Reactivate"}
        </button>
      )}
      {status === "ACTIVE" && (
        <button
          type="button"
          onClick={() => setAsking("ON_HOLD")}
          className={`${button} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:text-gray-200 dark:hover:bg-zinc-800`}
        >
          <PauseCircle size={13} /> Put on hold
        </button>
      )}
      {status !== "INACTIVE" && !compact && (
        <button
          type="button"
          onClick={() => setAsking("INACTIVE")}
          className={`${button} border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/30`}
        >
          <XCircle size={13} /> Mark inactive
        </button>
      )}
      {error && <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
