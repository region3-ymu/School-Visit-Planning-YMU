import Link from "next/link";
import { ReactNode } from "react";
import { Users, CalendarDays, Settings } from "lucide-react";

export default async function SchoolLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id: schoolId } = await params;
  const tabs = [
    { href: `/schools/${schoolId}`, label: "Horarios", icon: CalendarDays },
    { href: `/schools/${schoolId}/teachers`, label: "Profesores", icon: Users },
    { href: `/schools/${schoolId}/visit-rules`, label: "Visit Rules", icon: Settings },
  ];

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6 sm:pt-6">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/"
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Back
          </Link>
        </div>

        <nav className="flex flex-wrap gap-2 mb-6">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors text-sm font-semibold"
              >
                <Icon size={16} className="opacity-80" />
                {t.label}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </div>
  );
}

