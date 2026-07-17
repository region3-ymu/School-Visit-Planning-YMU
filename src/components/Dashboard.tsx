"use client";

import { useEffect, useState } from "react";
import { getDashboardStats } from "@/app/actions";
import { Building2, CalendarX, ClockAlert, ClipboardList } from "lucide-react";

export default function Dashboard({ regionFilter }: { regionFilter?: string | null }) {
    const [stats, setStats] = useState({
        totalActiveSchools: 0,
        dueThisWeek: 0,
        overdue: 0,
        recentCancellations: 0,
        visitedSchoolsList: [] as { id: string, name: string, visitCount: number }[],
    });

    useEffect(() => {
        getDashboardStats(regionFilter).then(setStats);
    }, [regionFilter]);

    return (
        <div className="p-6">
            <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100">Overview Dashboard</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg">
                        <Building2 size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Schools</p>
                        <p className="text-3xl font-semibold text-gray-800 dark:text-gray-100">{stats.totalActiveSchools}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-lg">
                        <ClipboardList size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Due This Week</p>
                        <p className="text-3xl font-semibold text-gray-800 dark:text-gray-100">{stats.dueThisWeek}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
                    <div className="p-3 bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg">
                        <ClockAlert size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Overdue</p>
                        <p className="text-3xl font-semibold text-gray-800 dark:text-gray-100">{stats.overdue}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 flex items-center space-x-4">
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 rounded-lg">
                        <CalendarX size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Recent Cancellations</p>
                        <p className="text-3xl font-semibold text-gray-800 dark:text-gray-100">{stats.recentCancellations}</p>
                    </div>
                </div>
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
