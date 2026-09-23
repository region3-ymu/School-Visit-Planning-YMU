import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { UPDATES } from "@/lib/updates/entries";

export const metadata = { title: "Updates" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "23 September 2026" from "2026-09-23", by reading the three numbers rather
// than by building a Date. `new Date("2026-09-23")` is midnight UTC, and this
// app renders dates in Miami time — every line would come out a day early.
function formatEntryDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Everyone who can sign in to SVP is a manager, so there is nothing to filter
// and no role gate — unlike YMU-A, where teachers see a shorter log.
export default async function UpdatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft size={16} />
        Back
      </Link>

      <header className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
          <History size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Updates
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            What&apos;s new in School Visit Planning.
          </p>
        </div>
      </header>

      <ol className="grid grid-cols-1 gap-3">
        {UPDATES.map((entry) => (
          <li
            key={entry.date}
            className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {formatEntryDate(entry.date)}
            </h2>
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {entry.items.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gray-300 dark:bg-zinc-600"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    {item.module && (
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {item.module} —{" "}
                      </span>
                    )}
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}
