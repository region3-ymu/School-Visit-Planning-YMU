"use client";

import { useEffect, useRef, useState } from "react";
import { useSerwist } from "@serwist/turbopack/react";
import { RefreshCw } from "lucide-react";

/**
 * Solves "I deployed a fix and they're still running yesterday's build" — the
 * failure mode an installed PWA introduces, since the home-screen app has no
 * address bar and nobody ever hard-reloads it.
 *
 * Built on the canonical waiting-worker flow (sw.ts sets skipWaiting: false):
 *
 *   1. FORCE update checks. Browsers may not re-check the worker script for up
 *      to ~24h on their own, so a device can sit on a stale bundle
 *      indefinitely. Check on mount, on an interval, and on tab focus.
 *   2. A new worker installs and, because skipWaiting is off, parks in
 *      "waiting" rather than taking over silently. That waiting worker IS the
 *      pending update — show the banner.
 *   3. On click, tell it to skipWaiting. It activates, clientsClaim gives it
 *      control, "controlling" fires, and only then do we reload — once — into
 *      the new assets. No timeout guesswork.
 */
export default function SwUpdatePrompt() {
  const { serwist } = useSerwist();
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!serwist) return;
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;

    let cancelled = false;

    // A worker in "waiting" is unambiguously an installed-but-not-applied
    // update: a first-ever install goes installing -> activating and never
    // waits, so this cannot misfire on someone's first visit.
    const onWaiting = () => {
      if (!cancelled) setUpdateReady(true);
    };
    // Guarded by reloadingRef so a background update in ANOTHER tab can't yank
    // a reload out from under this one mid-edit; this tab keeps showing its
    // banner until the user chooses.
    const onControlling = () => {
      if (reloadingRef.current) window.location.reload();
    };
    serwist.addEventListener("waiting", onWaiting);
    serwist.addEventListener("controlling", onControlling);

    // "waiting" only fires for a worker that installs while this listener is
    // attached. One that finished installing during an earlier visit is
    // already parked and will never replay the event — so ask the registration
    // directly on mount.
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!cancelled && reg?.waiting) setUpdateReady(true);
      })
      .catch(() => {
        /* no registration yet — the checks below will catch it */
      });

    // Checks go through the REGISTRATION, not serwist.update().
    //
    // serwist.update() throws if the instance's own register() has not
    // resolved yet — and, worse, logs its own red "Cannot update a Serwist
    // instance without being registered" to the console on the way out. On a
    // cold load this component mounts before SerwistProvider has finished
    // registering, so every single page view printed that error. A try/catch
    // silences the throw but not the log, and there is no ordering guarantee
    // to wait for. The browser's own update() has neither problem, acts on the
    // same registration serwist is wrapping, and re-checks reg.waiting
    // straight afterwards — so detection does not depend on catching an event.
    const check = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return; // not registered yet — the interval retries
      try {
        await registration.update();
      } catch {
        /* offline / transient — the interval retries */
      }
      if (!cancelled && registration.waiting) setUpdateReady(true);
    };
    void check();
    const interval = setInterval(check, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      serwist.removeEventListener("waiting", onWaiting);
      serwist.removeEventListener("controlling", onControlling);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [serwist]);

  async function applyUpdate() {
    reloadingRef.current = true;
    setReloading(true);
    // Posted straight to the waiting worker rather than through
    // serwist.messageSkipWaiting(), for the same reason check() uses the
    // registration: no dependency on serwist's own register() having resolved.
    // "SKIP_WAITING" is the message its service worker handles (it calls
    // self.skipWaiting()), so this is the same instruction by the same
    // contract. The worker then activates, clientsClaim gives it control, and
    // "controlling" above does the reload; the timeout is only a safety net
    // for the rare case that event never arrives.
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    setTimeout(() => window.location.reload(), 3000);
  }

  if (!updateReady) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] mx-auto flex w-full max-w-md items-center justify-between gap-3 bg-indigo-600 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-lg sm:top-4 sm:rounded-full sm:pt-3">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <RefreshCw size={16} aria-hidden />
        A new version is available.
      </span>
      <button
        type="button"
        onClick={applyUpdate}
        disabled={reloading}
        className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-bold text-indigo-600 disabled:opacity-60"
      >
        {reloading ? "Updating…" : "Update"}
      </button>
    </div>
  );
}
