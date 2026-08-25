"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { getSchoolProfile } from "@/app/actions";
import VisitDetails from "@/components/visit/VisitDetails";

type Profile = NonNullable<Awaited<ReturnType<typeof getSchoolProfile>>>;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5">
      {children}
    </div>
  );
}

/**
 * A school's page: when it teaches, who teaches it, and what past visits found.
 *
 * The visit form's answers only lived in the flat Visit History list, mixed in
 * with every other school. Reading a school's own record before walking into it
 * is the reason for collecting them.
 */
export default function SchoolProfileView({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  useEffect(() => {
    getSchoolProfile(schoolId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [schoolId]);

  if (loading) return <Card>Cargando…</Card>;
  if (!data) return <Card>School not found.</Card>;

  const { school, schedule, teachers, visits } = data;
  const byDay = DAYS.map((d) => ({ day: d, slots: schedule.filter((s) => s.weekdayLabel === d) }));

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-xl font-bold">{school.name}</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {school.address && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} /> {school.address}
            </span>
          )}
          {school.regionName && <span>{school.regionName}</span>}
          <span>Zip: {school.zipCode ?? "—"}</span>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-indigo-600 dark:text-indigo-400" />
          Weekly schedule
        </h2>
        {schedule.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No classes on the calendar for this school year.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {byDay.map(({ day, slots }) => (
              <div key={day}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{day}</p>
                {slots.length === 0 ? (
                  <p className="text-xs text-gray-400">—</p>
                ) : (
                  <div className="space-y-1.5">
                    {slots.map((s, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-gray-200 dark:border-zinc-700 p-2"
                      >
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{s.subject}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {s.start}–{s.end}
                        </p>
                        {s.teacherName && (
                          <Link
                            href={`/teachers/${s.teacherId}`}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {s.teacherName}
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Users size={16} className="text-indigo-600 dark:text-indigo-400" />
          Teachers here
        </h2>
        {teachers.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No teachers on record.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {teachers.map((t) => (
              <Link
                key={t.id}
                href={`/teachers/${t.id}`}
                className="rounded-lg border border-gray-200 dark:border-zinc-700 px-3 py-2 hover:border-indigo-400 transition-colors"
              >
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{t.name}</span>
                {t.subjectsHere.length > 0 && (
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {t.subjectsHere.join(" · ")}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Visit history</h2>
        {visits.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No visits logged here yet.</p>
        ) : (
          <div className="space-y-2">
            {visits.map((v) => (
              <div key={v.id} className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
                <button
                  onClick={() => setOpenVisit(openVisit === v.id ? null : v.id)}
                  className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      {format(new Date(v.date), "MMM d, yyyy")}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {v.visitedByName}
                      {!v.isMine && " · another RM"}
                    </span>
                  </div>
                  {v.notes && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{v.notes}</p>
                  )}
                </button>
                {openVisit === v.id && <VisitDetails visit={{ ...v, visitedByName: v.visitedByName }} />}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
