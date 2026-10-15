"use client";

import { useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import type { VisitInfo } from "@/lib/types";
import { WINDOW_LABELS, type ResolvedWindow, type VisitWindow, type WindowMode } from "@/lib/visitWindow";

/**
 * "On your calendar: 11:25–11:45 · First 20 min" under a visit, and the
 * choice behind it (#55). Untouched visits follow the week's default; picking
 * here overrides it for this visit only, and "Use default" goes back.
 * `resolved` comes from resolveDayWindows, which sees the whole day: the
 * default may take the last 20 minutes to stay clear of another visit, and a
 * visit that can't be reached in time is flagged.
 */
export default function VisitWindowPicker({
  resolved,
  choice,
  fallback,
  onChange,
  onFix,
  editable,
}: {
  resolved: ResolvedWindow | null;
  choice: VisitWindow | undefined;
  fallback: VisitWindow;
  onChange: (w: VisitWindow | null) => void;
  /** Applies a suggested fix, which may be on the visit before this one. */
  onFix: (visit: VisitInfo, w: VisitWindow) => void;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!resolved) return null;

  const mode: WindowMode | "default" = choice?.mode ?? "default";
  const summary = `${resolved.start}–${resolved.end} · ${resolved.label}${choice ? "" : " (default)"}`;
  const c = resolved.conflict;
  const conflict = c && (
    <div className="mt-1 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-1.5 text-[11px] text-amber-800 dark:text-amber-300">
      <p className="flex items-start gap-1">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>
          Not enough time: you leave {c.fromSchool} at {c.leaveAt}, {c.estimated ? "about " : ""}
          {c.driveMinutes} min drive{c.estimated ? " (estimate)" : ""}, so you&apos;d arrive at {c.arriveAt} — after {resolved.start}.
        </span>
      </p>
      {editable && c.fixes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {c.fixes.map((fix) => (
            <button
              key={fix.text}
              type="button"
              onClick={() => onFix(fix.visit, fix.window)}
              className="rounded-full border border-amber-300 dark:border-amber-800 bg-white dark:bg-zinc-800 px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              {fix.text}
            </button>
          ))}
        </div>
      )}
      {c.fixes.length === 0 && (
        <p className="mt-1">No slice of either class works — postpone one of the two visits.</p>
      )}
    </div>
  );

  if (!editable) {
    return (
      <div className="mb-2">
        <p className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
          <CalendarClock size={12} /> On your calendar: {summary}
        </p>
        {conflict}
      </div>
    );
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline text-left"
        title="Choose how long this visit is on your Google Calendar"
      >
        <CalendarClock size={12} className="shrink-0" /> On your calendar: {summary}
      </button>
      {conflict}
      {open && (
        <div className="mt-1.5 grid gap-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 p-2 text-xs">
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as WindowMode | "default";
              if (m === "default") onChange(null);
              else if (m === "custom") onChange({ mode: "custom", start: resolved.start, minutes: choice?.minutes ?? 30 });
              else onChange({ mode: m });
            }}
            className="w-full rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5"
          >
            <option value="default">Use default ({WINDOW_LABELS[fallback.mode]})</option>
            {(["first", "last", "whole", "recommended", "custom"] as WindowMode[]).map((m) => (
              <option key={m} value={m}>
                {WINDOW_LABELS[m]}
              </option>
            ))}
          </select>
          {choice?.mode === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                Start
                <input
                  type="time"
                  value={choice.start ?? resolved.start}
                  onChange={(e) => onChange({ ...choice, start: e.target.value })}
                  className="rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 py-1"
                />
              </label>
              <label className="flex items-center gap-1">
                for
                <input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={choice.minutes ?? 30}
                  onChange={(e) => onChange({ ...choice, minutes: Number(e.target.value) || 30 })}
                  className="w-16 rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 py-1"
                />
                min
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
