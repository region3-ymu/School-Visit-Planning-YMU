"use client";

import { useEffect, useState } from "react";
import { getSchools } from "@/app/actions";
import { MapPin, Search, Clock } from "lucide-react";
import Link from "next/link";

export default function SchoolProfiles({ regionFilter }: { regionFilter?: string | null }) {
    const [schools, setSchools] = useState<any[]>([]);
    const [search, setSearch] = useState("");

    useEffect(() => {
        getSchools(regionFilter).then(setSchools);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [regionFilter]);

    const filteredSchools = schools.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">School Directory</h2>
                <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search schools..."
                        className="pl-10 pr-4 py-2 border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSchools.map((school) => (
                    <div key={school.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm relative overflow-hidden hover:border-indigo-500 transition-colors">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 mb-2">{school.name}</h3>

                        <div className="flex items-center text-sm text-gray-500 mb-4">
                            <MapPin size={16} className="mr-1" /> Zip: {school.zipCode}
                        </div>

                        <div className="mt-2 mb-4">
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                                <Clock size={12} className="mr-1" />
                                Schedule Windows
                            </h4>
                            {(() => {
                                try {
                                    const rules = JSON.parse(school.availability);
                                    if (!Array.isArray(rules) || rules.length === 0)
                                        return <span className="text-xs text-gray-500">No specific windows set.</span>;
                                    return (
                                        <div className="space-y-2">
                                            {rules.map((rule: any, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-zinc-950 p-2 rounded-md border border-gray-100 dark:border-zinc-800">
                                                    <div className="flex items-center space-x-2">
                                                        <span className={`px-1.5 py-0.5 rounded font-bold ${rule.weekday ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400'}`}>
                                                            {rule.weekday ? rule.weekday.substr(0, 3) : (rule.dayType ? `Day ${rule.dayType} (legacy)` : '?')}
                                                        </span>
                                                        <span className="font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[120px]" title={rule.class}>
                                                            {rule.class || 'Visit'}
                                                        </span>
                                                    </div>
                                                    <span className="text-gray-500 font-mono text-[10px]">
                                                        {rule.start}-{rule.end}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                } catch {
                                    return <div className="text-xs text-red-500 font-mono truncate">{school.availability}</div>;
                                }
                            })()}
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
