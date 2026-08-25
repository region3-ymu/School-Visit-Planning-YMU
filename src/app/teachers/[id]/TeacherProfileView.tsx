"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, GraduationCap, Info } from "lucide-react";
import { getTeacherProfile } from "@/app/actions";
import {
  OBSERVATION_DOMAINS,
  RATING_OPTIONS,
  SKIP_REASONS,
  type ObservationRating,
  type ObservationSkipReason,
} from "@/components/visit/TeacherObservationFields";

type Profile = NonNullable<Awaited<ReturnType<typeof getTeacherProfile>>>;

const RATING_TONE: Record<ObservationRating, string> = {
  NEEDS_SUPPORT: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  DEVELOPING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MEETS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  EXCEEDS: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
};

const ratingLabel = (r: ObservationRating) => RATING_OPTIONS.find((o) => o.value === r)?.label ?? r;
const skipLabel = (r: ObservationSkipReason) => SKIP_REASONS.find((o) => o.value === r)?.label ?? r;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5">
      {children}
    </div>
  );
}

/**
 * One teacher across every school they work.
 *
 * Ratings were filed against a visit, and a visit is to a school, so nothing
 * ever gathered them per person — the rubric could be filled in for a year
 * without anyone being able to see whether a teacher had improved.
 */
export default function TeacherProfileView({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTeacherProfile(teacherId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [teacherId]);

  if (loading) return <Card>Cargando…</Card>;
  if (!data) return <Card>Teacher not found.</Card>;

  const { teacher, assignments, classCount, schoolCount, observations } = data;
  const rated = observations.filter((o) => Object.values(o.ratings).some(Boolean));
  const schoolsWithMe = new Set(assignments.map((a) => a.schoolId));

  return (
    <div className="space-y-4">
      <Link
        href="/?tab=profiles"
        className="inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        <ArrowLeft size={14} /> Schools
      </Link>

      <Card>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <GraduationCap size={20} className="text-indigo-600 dark:text-indigo-400" />
          {teacher.name}
        </h1>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {classCount} class{classCount === 1 ? "" : "es"} across {schoolCount} school
          {schoolCount === 1 ? "" : "s"} this year
          {teacher.email && ` · ${teacher.email}`}
          {!teacher.fromYmuA && " · not linked to YMU-A"}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold mb-3">Where they teach</h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No classes on the calendar for this school year.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {assignments.map((a, i) => (
              <Link
                key={i}
                href={`/schools/${a.schoolId}`}
                className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3 hover:border-indigo-400 transition-colors"
              >
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{a.schoolName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {a.subject} · {a.count} class{a.count === 1 ? "" : "es"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-1">Observations</h2>
        {/* Said plainly rather than quietly presented as this teacher's own: a
            visit records the school it was to, not which teacher was watched. */}
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 flex items-start gap-1.5">
          <Info size={12} className="shrink-0 mt-0.5" />
          Visits where a YMU teacher was seen at a school this teacher works. Where a school has
          more than one teacher, a visit appears on both — the visit records the school, not which
          teacher was watched.
        </p>

        {observations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No visits have recorded seeing a YMU teacher at these schools yet.
          </p>
        ) : (
          <div className="space-y-3">
            {observations.map((o) => {
              const domains = OBSERVATION_DOMAINS.filter((d) => o.ratings[d.key]);
              return (
                <div key={o.id} className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      {format(new Date(o.date), "MMM d, yyyy")} ·{" "}
                      <Link
                        href={`/schools/${o.schoolId}`}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {o.schoolName}
                      </Link>
                      {!schoolsWithMe.has(o.schoolId) && (
                        <span className="text-gray-400"> (no longer teaches here)</span>
                      )}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{o.visitedByName}</span>
                  </div>

                  {o.obsSkipReason ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Not evaluated — {skipLabel(o.obsSkipReason).toLowerCase()}
                      {o.obsSkipNotes && (
                        <span className="text-gray-600 dark:text-gray-400"> · {o.obsSkipNotes}</span>
                      )}
                    </p>
                  ) : domains.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                      {domains.map((d) => {
                        const r = o.ratings[d.key] as ObservationRating;
                        return (
                          <div key={d.key} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-gray-700 dark:text-gray-300">{d.title}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${RATING_TONE[r]}`}>
                              {ratingLabel(r)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No ratings recorded.</p>
                  )}

                  {o.obsNotes && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 whitespace-pre-wrap">
                      {o.obsNotes}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {rated.length > 1 && (
          <p className="text-xs text-gray-400 mt-3">
            {rated.length} visits with ratings, oldest last — the column reads as a record over time.
          </p>
        )}
      </Card>
    </div>
  );
}
