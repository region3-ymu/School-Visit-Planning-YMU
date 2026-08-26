"use client";

import { useEffect, useState } from "react";
import { getSchools, getSchoolWeeklySchedules } from "@/app/actions";
import { MapPin, Search, Clock } from "lucide-react";
import Link from "next/link";

export default function SchoolProfiles({ regionFilter }: { regionFilter?: string | null }) {
    type School = Awaited<ReturnType<typeof getSchools>>[number];
    type Schedules = Awaited<ReturnType<typeof getSchoolWeeklySchedules>>;
    const [schools, setSchools] = useState<School[]>([]);
    const [schedules, setSchedules] = useState<Schedules>({});
    const [search, setSearch] = useState("");

    useEffect(() => {
        getSchools(regionFilter).then(async (list) => {
            setSchools(list);
            // The real timetable, from the calendar. School.availability was a
            // hand-kept blob that mostly said "no windows set" or named an A/B day
            // nobody uses any more.
            setSchedules(await getSchoolWeeklySchedules(list.map((s) => s.id)));
        });
    }, [regionFilter]);

    const filteredSchools = schools.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="p-4 sm:p-6">
            <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">School Directory</h2>
                <div className="relative w-full sm:w-auto">
                    <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search schools..."
                        className="w-full sm:w-auto pl-10 pr-4 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSchools.map((school) => (
                    <div key={school.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm relative overflow-hidden hover:border-indigo-500 transition-colors">
                        <Link href={`/schools/${school.id}`} className="block group">
                            <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {school.name}
                            </h3>
                        </Link>

                        <div className="flex items-center text-sm text-gray-500 mb-4">
                            <MapPin size={16} className="mr-1" /> Zip: {school.zipCode}
                        </div>

                        <div className="mt-2 mb-4">
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                                <Clock size={12} className="mr-1" />
                                Weekly Classes
                            </h4>
                            {(schedules[school.id] ?? []).length === 0 ? (
                                <span className="text-xs text-gray-500">No classes on the calendar.</span>
                            ) : (
                                <div className="space-y-1.5">
                                    {(schedules[school.id] ?? []).map((prog, idx) => (
                                        <div key={idx} className="text-xs bg-gray-50 dark:bg-zinc-950 p-2 rounded-md border border-gray-100 dark:border-zinc-800">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="font-semibold text-gray-700 dark:text-gray-300 truncate" title={prog.subject}>
                                                    {prog.subject}
                                                </span>
                                                {/* The sheet's own wording where there is one; otherwise
                                                    what the calendar dates show. */}
                                                <span className={`px-1.5 py-0.5 rounded font-bold shrink-0 ${
                                                    prog.cadence === "alternating"
                                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                                                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
                                                }`} title={
                                                    prog.sheetDayPatterns.length > 0
                                                        ? "From the master programmes schedule"
                                                        : prog.cadence === "alternating"
                                                            ? "Runs every other week, counted from the calendar"
                                                            : "Runs every week, counted from the calendar"
                                                }>
                                                    {prog.sheetDayPatterns.length > 0
                                                        ? prog.sheetDayPatterns.join(" / ")
                                                        : prog.cadence === "alternating" ? "alt weeks" : "weekly"}
                                                </span>
                                            </div>
                                            {prog.teacherName && (
                                                <div className="text-[10px] text-gray-500 truncate">{prog.teacherName}</div>
                                            )}
                                            {/* One line per time, because Wednesdays usually shift. */}
                                            {prog.slots.map((slot, si) => (
                                                <div key={si} className="flex justify-between text-[10px] text-gray-500 font-mono">
                                                    <span>{slot.days.join(" ")}</span>
                                                    <span>{slot.start}-{slot.end}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
                            <div className="flex items-center gap-3">
                                <Link
                                    href={`/schools/${school.id}/teachers`}
                                    className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
                                >
                                    Profesores
                                </Link>
                                <Link
                                    href={`/schools/${school.id}/visit-rules`}
                                    className="text-sm font-medium text-violet-600 hover:text-violet-700"
                                >
                                    Visit Rules
                                </Link>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
