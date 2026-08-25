/**
 * SVP's service worker exists to make the app INSTALLABLE and to load its
 * shell instantly. It deliberately does NOT try to make the app work offline.
 *
 * This is the one place where copying YMU-A would have been wrong. YMU-A caches
 * pages with NetworkFirst because a teacher has to clock in from inside a
 * school building with no signal, and it can serve real content offline because
 * its data is mirrored into IndexedDB (Dexie) on the device.
 *
 * SVP has neither half of that. Every screen is server-rendered from Neon
 * through server actions, so a cached page offline would render a shell with no
 * schools, no week, no map — and caching authenticated HTML to disk to achieve
 * that is a bad trade twice over: it leaks one RM's region onto the device, and
 * a stale shell from before a deploy asks for JS chunks that no longer exist.
 *
 * So: precache the build's static assets (that is what makes the installed app
 * open instantly), let serwist's defaults handle fonts and images, and answer
 * any page request that cannot be served with an honest offline screen.
 * If SVP ever needs real offline planning, the work is a local data mirror
 * first — not a page cache.
 */
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The dynamic half of the app: never written to disk.
 *
 * This rule is not optional decoration — serwist's own defaultCache ends with
 * NetworkFirst rules for same-origin HTML, for RSC navigations and for
 * everything under /api/. Left to run, they would quietly cache one Regional
 * Manager's schools, visits and mileage into the browser's cache storage,
 * which is the opposite of what the comment above claims this worker does.
 *
 * Registered BEFORE defaultCache because the router answers with the first
 * matching route, and those catch-alls would otherwise swallow these requests.
 *
 * NetworkOnly still gets the offline fallback: serwist attaches its fallback
 * plugin to every runtimeCaching entry's handler, and a failed fetch here
 * therefore ends up on /~offline rather than the browser's error page.
 */
const neverCache = [
  {
    matcher: ({
      request,
      sameOrigin,
      url,
    }: {
      request: Request;
      sameOrigin: boolean;
      url: URL;
    }) =>
      sameOrigin &&
      (request.destination === "document" ||
        request.headers.get("RSC") === "1" ||
        url.pathname.startsWith("/api/")),
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // skipWaiting is DELIBERATELY false: a new worker installs and sits in
  // "waiting" instead of taking over mid-session, which is what lets
  // SwUpdatePrompt offer the update and reload deterministically once the user
  // accepts. (YMU-A learned this the hard way — with skipWaiting:true the
  // worker never enters "waiting", so the banner had to guess with a timeout.)
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...neverCache, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
