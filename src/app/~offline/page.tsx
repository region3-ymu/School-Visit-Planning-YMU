import type { Metadata } from "next";
import { CloudOff } from "lucide-react";

export const metadata: Metadata = {
  title: "Offline — SVP",
};

// The service worker serves this whenever a page is requested and the network
// cannot answer (see src/app/sw.ts). It says plainly that SVP needs a
// connection instead of implying the app is broken, because that is the truth
// here: unlike YMU-A, SVP keeps no copy of the data on the device, so there is
// nothing useful it could show. Static and auth-free by design — it has to
// render with no server and no session.
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-gray-50 p-6 text-center dark:bg-[#0a0a0a]">
      <CloudOff size={40} className="text-gray-400 dark:text-gray-500" aria-hidden />
      <h1 className="text-xl font-black tracking-tight text-indigo-600 dark:text-indigo-400">
        You&apos;re offline
      </h1>
      <p className="max-w-sm text-sm text-gray-600 dark:text-gray-400">
        SVP plans routes from live school and visit data, so it needs a
        connection. Nothing you saved is lost — reconnect and reopen the app.
      </p>
    </main>
  );
}
