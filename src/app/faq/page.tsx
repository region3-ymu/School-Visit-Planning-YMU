import Link from "next/link";
import { ArrowLeft, ChevronDown, HelpCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canPlanVisits } from "@/lib/permissions";
import { faqFor } from "@/lib/faq/entries";
import type { Role } from "@prisma/client";

export const metadata = { title: "Help" };

// How the app works, and what to do when it doesn't. Everyone signed in reads
// it; the sections are filtered so the oversight roles are not told how to use
// buttons they do not have. See src/lib/faq/entries.ts.
export default async function FaqPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role | undefined;
  const sections = faqFor(role && canPlanVisits(role) ? "planners" : "everyone");

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
          <HelpCircle size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Help</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            How the app works, and what to do when it doesn&apos;t.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {section.title}
            </h2>
            <div className="mt-2 divide-y divide-gray-100 dark:divide-zinc-800">
              {section.items.map((item) => (
                // <details> rather than a custom accordion: it opens without
                // JavaScript and the browser's own find-in-page reaches inside.
                <details key={item.q} className="group py-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                    <span className="min-w-0">{item.q}</span>
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-gray-400 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5">
                    {item.a.map((paragraph, i) => (
                      <p key={i} className="text-sm text-gray-600 dark:text-gray-400">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
