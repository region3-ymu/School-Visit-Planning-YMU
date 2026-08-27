"use client";

import { useEffect, useState } from "react";
import { getDashboardStats } from "@/app/actions";
import {
    Building2,
    CalendarX,
    ClipboardList,
    ClockAlert,
    Footprints,
    MapPinOff,
    Phone,
    Video,
} from "lucide-react";

const TONES = {
    blue: "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400",
    amber: "bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400",
    red: "bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400",
    slate: "bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400",
} as const;

// Four near-identical card bodies were copied out by hand, which is how three of
// them ended up displaying numbers nobody had computed.
function StatCard({
    label,
    value,
    hint,
    icon,
    tone,
}: {
    label: string;
    value: number;
    hint?: string;
    icon: React.ReactNode;
    tone: keyof typeof TONES;
}) {
    return (
        <div className="bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center gap-4">
            <div className={`p-3 rounded-lg shrink-0 ${TONES[tone]}`}>{icon}</div>
            <div className="min-w-0">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
                <p className="text-2xl sm:text-3xl font-semibold text-gray-800 dark:text-gray-100">{value}</p>
                {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
            </div>
        </div>
    );
}

export default function Dashboard({ regionFilter }: { regionFilter?: string | null }) {
    const [stats, setStats] = useState({
        totalActiveSchools: 0,
        dueThisWeek: 0,
        overdue: 0,
        neverVisited: 0,
        recentCancellations: 0,
        cancellationWindowDays: 30,
        thisWeek: { inPerson: 0, online: 0, phone: 0, total: 0 },
        visitedSchoolsList: [] as { id: string, name: string, visitCount: number }[],
    });

    useEffect(() => {
        getDashboardStats(regionFilter).then(setStats);
    }, [regionFilter]);

    return (
        <div className="p-4 sm:p-6">
            <h2 className="text-xl sm:text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100">Overview Dashboard</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <StatCard
                    label="Active Schools"
                    value={stats.totalActiveSchools}
                    icon={<Building2 size={24} />}
                    tone="blue"
                />
                <StatCard
                    label="Due This Week"
                    value={stats.dueThisWeek}
                    hint="Falls due before Sunday"
                    icon={<ClipboardList size={24} />}
                    tone="amber"
                />
                <StatCard
                    label="Overdue"
                    value={stats.overdue}
                    hint="Past its interval"
                    icon={<ClockAlert size={24} />}
                    tone="red"
                />
                {/* The number that was missing entirely. A school nobody has ever
                    walked into does not show up as "overdue" — it has no last
                    visit to be late from — so it was invisible on this screen
                    while the planner was shouting about it. */}
                <StatCard
                    label="Never Visited"
                    value={stats.neverVisited}
                    hint="No in-person visit on record"
                    icon={<MapPinOff size={24} />}
                    tone="slate"
                />
            </div>

            <div className="mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                {/* Visits, not schools: the same school twice in a week is two
                    visits, and the office is not a school anybody is covering. */}
                <div className="lg:col-span-2 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
                    <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Your visits this week
                        </p>
                        <p className="text-2xl sm:text-3xl font-semibold text-gray-800 dark:text-gray-100">
                            {stats.thisWeek.total}
                        </p>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                        {[
                            { label: "In person", value: stats.thisWeek.inPerson, icon: <Footprints size={16} /> },
                            { label: "Online", value: stats.thisWeek.online, icon: <Video size={16} /> },
                            { label: "Phone", value: stats.thisWeek.phone, icon: <Phone size={16} /> },
                        ].map((row) => (
                            <div
                                key={row.label}
                                className="rounded-lg bg-gray-50 dark:bg-zinc-800/50 px-2 py-2 sm:px-3 sm:py-3"
                            >
                                <p className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-gray-500 dark:text-gray-400">
                                    <span className="text-indigo-500 dark:text-indigo-400">{row.icon}</span>
                                    <span className="truncate">{row.label}</span>
                                </p>
                                <p className="mt-0.5 text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100">
                                    {row.value}
                                </p>
                            </div>
                        ))}
                    </div>
                    <p className="mt-3 text-[11px] text-gray-400">
                        Schools only — trips to the office aren&apos;t counted. A school visited
                        twice counts twice.
                    </p>
                </div>

                <StatCard
                    label="Reported Cancellations"
                    value={stats.recentCancellations}
                    hint={`Classes cancelled on you, last ${stats.cancellationWindowDays} days`}
                    icon={<CalendarX size={24} />}
                    tone="slate"
                />
            </div>

            <div className="mt-8 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-100 dark:border-zinc-800">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center">
                        <Building2 size={18} className="mr-2 text-indigo-500" />
                        Escuelas Visitadas
                    </h3>
                </div>
                <div className="p-0">
                    {stats.visitedSchoolsList.length === 0 ? (
                        <div className="p-8 text-center text-sm text-gray-500">
                            Aún no se han registrado visitas.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
                            {stats.visitedSchoolsList.map((school) => (
                                <li key={school.id} className="p-4 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                                    <span className="font-medium text-gray-800 dark:text-gray-200">
                                        {school.name}
                                    </span>
                                    <span className="text-sm px-3 py-1 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold rounded-full">
                                        {school.visitCount} visita{school.visitCount !== 1 ? 's' : ''}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
