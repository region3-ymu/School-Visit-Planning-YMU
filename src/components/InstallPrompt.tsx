"use client";

import { useEffect, useState } from "react";
import { Share, Smartphone } from "lucide-react";

const DISMISSED_KEY = "svp-install-prompt-dismissed";

// Chrome/Edge (Android + desktop) fire this before showing their own install
// UI; capturing it lets us offer a real button instead of relying on the
// browser's own entry point, which on Android is a not-very-discoverable
// "Install app" menu item and on iOS does not exist at all. Not in the
// standard DOM typings.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIOS(): boolean {
  // iPadOS 13+ reports as "MacIntel", but with touch points, unlike a real Mac.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * "Install this app" banner, mounted app-wide in the root layout so it shows
 * signed in or not.
 *
 * Android/Chrome/Edge get a working Install button wired to the captured
 * beforeinstallprompt event. Safari never fires that event — Apple has no API
 * for triggering add-to-home-screen — so iOS gets the manual steps instead,
 * which is the difference between an RM installing this on their iPhone and
 * concluding it can't be done. Dismissal is remembered in localStorage so it
 * asks once, not every visit.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosPrompt, setIosPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Starts dismissed and un-dismisses here, rather than reading localStorage
    // in the initial state, because none of localStorage, the user agent or
    // display-mode exist during SSR — and defaulting to "hidden" means the
    // banner can never flash on for someone who already dismissed it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setDismissed(Boolean(localStorage.getItem(DISMISSED_KEY)));

    if (isStandalone()) return; // already installed — nothing to prompt.

    if (isIOS()) {
      setIosPrompt(true);
      return;
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  if (dismissed || (!deferredPrompt && !iosPrompt)) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-2 bg-indigo-600 p-4 text-white shadow-lg sm:bottom-4 sm:rounded-2xl">
      <p className="flex items-center gap-2 text-sm font-bold">
        <Smartphone size={16} aria-hidden />
        Install SVP
      </p>
      {iosPrompt ? (
        <p className="flex items-start gap-1.5 text-xs text-indigo-100">
          <Share size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Tap the <strong>Share</strong> icon in Safari, then{" "}
            <strong>&quot;Add to Home Screen&quot;</strong> — it opens in its own
            window, without the browser bars.
          </span>
        </p>
      ) : (
        <p className="text-xs text-indigo-100">
          Add it to your home screen to plan your week in its own window.
        </p>
      )}
      <div className="mt-1 flex items-center gap-4">
        {deferredPrompt && (
          <button
            type="button"
            onClick={handleInstall}
            className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-indigo-600"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="text-sm font-semibold text-indigo-100 underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
