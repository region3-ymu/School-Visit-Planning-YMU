"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, X } from "lucide-react";
import { submitReport, type ReportState } from "@/app/report/actions";

const KINDS = [
  { value: "bug", label: "Something is broken" },
  { value: "request", label: "I'd like something added" },
  { value: "question", label: "I have a question" },
] as const;

// YMU-A's vocabulary, deliberately. Both apps' reports land in one table and
// one spreadsheet, and a severity that means something different depending on
// which app it came from is worse than no severity at all.
const SEVERITIES = [
  { value: "blocked", label: "It stopped me working" },
  { value: "hindered", label: "I worked around it" },
  { value: "cosmetic", label: "Just cosmetic" },
] as const;

/**
 * A phone screenshot shrunk to a JPEG that fits in a server action.
 *
 * Server actions take 1 MB by default and a raw phone screenshot is often two
 * or three; base64 adds a third on top. 1600px on the long side still reads
 * every label on a phone screen. Returns bare base64 (no data: prefix).
 */
async function shrinkScreenshot(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const [maxSide, quality] of [[1600, 0.8], [1200, 0.7], [900, 0.6]] as const) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (base64.length < 700_000) return base64;
  }
  throw new Error("That image is too large to attach.");
}

/**
 * Report a problem, from anywhere in SVP.
 *
 * The report goes to YMU-A's backlog — one queue for both apps, because YMU
 * triages from one inbox and one tracker. See src/lib/report/relay.ts.
 */
export default function ReportProblemButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(submitReport, undefined as ReportState);
  // useActionState has no reset, so its last result outlives the dialog: once
  // a report went through, every later open showed "Thanks" instead of the
  // form until a reload — YMU-A's BUG-032, which this form shared. Opening
  // marks the current result as seen; only a newer one counts.
  const [seenState, setSeenState] = useState<ReportState>(undefined);
  const fresh = state !== seenState;
  // Shrunk in the browser and carried as state: the file input itself has no
  // name, so the raw (often multi-MB) file never rides along with the form.
  const [screenshot, setScreenshot] = useState("");
  const [screenshotNote, setScreenshotNote] = useState<string | null>(null);

  const openDialog = () => {
    setSeenState(state);
    setScreenshot("");
    setScreenshotNote(null);
    setOpen(true);
  };

  const onPickScreenshot = async (file: File | undefined) => {
    setScreenshot("");
    setScreenshotNote(null);
    if (!file) return;
    try {
      setScreenshotNote("Preparing screenshot…");
      setScreenshot(await shrinkScreenshot(file));
      setScreenshotNote(null);
    } catch (e) {
      setScreenshotNote(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  };
  // Read at render rather than in an effect. The dialog below only exists
  // once `open` is true, and `open` can only become true from a click, so this
  // never runs during SSR and never needs a state round-trip.
  const meta = open
    ? {
        path: window.location.pathname + window.location.search,
        ua: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      }
    : { path: "/", ua: "", viewport: "" };

  // Escape closes it, like every other dialog the user has ever met.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={
          className ??
          "w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-zinc-800/50 dark:hover:text-gray-200 transition-colors"
        }
      >
        <Bug size={16} />
        <span>Report a problem</span>
      </button>

      {/* Portalled to <body>. The sidebar that hosts this button is a
          transformed element (it slides in on mobile), and a transformed
          ancestor becomes the containing block for `position: fixed` — so the
          overlay rendered inside the 224px rail instead of over the page. */}
      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report a problem"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-zinc-900 sm:rounded-2xl sm:pb-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Report a problem</h2>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  This goes straight to the team that maintains the app.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-zinc-800"
              >
                <X size={18} />
              </button>
            </div>

            {fresh && state?.ok ? (
              <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
                <p className="font-semibold">
                  Thanks — that&apos;s logged
                  {state.reportNumber ? ` as report #${state.reportNumber}` : ""}.
                </p>
                <p className="mt-1 opacity-90">
                  Somebody reads these. You&apos;ll hear back if we need more detail.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Close
                </button>
              </div>
            ) : (
              <form action={formAction} className="grid grid-cols-1 gap-3">
                <input type="hidden" name="page_path" value={meta.path} />
                <input type="hidden" name="user_agent" value={meta.ua} />
                <input type="hidden" name="viewport" value={meta.viewport} />
                <input type="hidden" name="screenshot" value={screenshot} />

                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">What kind of report is this?</span>
                  <select
                    name="kind"
                    defaultValue="bug"
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-100"
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">How much did it get in your way?</span>
                  <select
                    name="severity"
                    defaultValue=""
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-100"
                  >
                    <option value="">— not sure —</option>
                    {SEVERITIES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">What happened?</span>
                  <textarea
                    name="message"
                    rows={5}
                    required
                    placeholder="What you were doing, what you expected, and what happened instead. Which school or which day, if it matters."
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-100"
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Screenshot (optional)</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => onPickScreenshot(e.target.files?.[0])}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-medium file:text-indigo-700 dark:text-gray-300 dark:file:bg-indigo-500/10 dark:file:text-indigo-300"
                  />
                  {screenshotNote && <span className="text-xs text-gray-500">{screenshotNote}</span>}
                </label>

                {fresh && state && !state.ok && (
                  <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                    {state.error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending || screenshotNote === "Preparing screenshot…"}
                  className="mt-1 h-11 rounded-full bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {pending ? "Sending…" : "Send report"}
                </button>
                <p className="text-xs text-gray-400">
                  Your name, email and the page you&apos;re on are sent with it.
                </p>
              </form>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
