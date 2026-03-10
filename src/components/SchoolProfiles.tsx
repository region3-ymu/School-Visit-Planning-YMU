"use client";

import { useEffect, useState } from "react";
import { getSchools, updateSchoolSettings } from "@/app/actions";
import { MapPin, Search, X, Save, Clock } from "lucide-react";

export default function SchoolProfiles() {
    const [schools, setSchools] = useState<any[]>([]);
    const [search, setSearch] = useState("");
    const [editingSchool, setEditingSchool] = useState<any | null>(null);
    const [editFormData, setEditFormData] = useState({ frequencyTarget: "", availability: "" });

    const fetchSchools = () => getSchools().then(setSchools);

    useEffect(() => {
        fetchSchools();
    }, []);

    const handleEditClick = (school: any) => {
        setEditingSchool(school);
        setEditFormData({
            frequencyTarget: school.frequencyTarget,
            availability: school.availability
        });
    };

    const handleSaveEdit = async () => {
        if (!editingSchool) return;
        try {
            await updateSchoolSettings(editingSchool.id, editFormData);
            setEditingSchool(null);
            fetchSchools(); // Refresh list after saving
        } catch (e) {
            alert("Failed to save. Ensure JSON is valid.");
        }
    };

    const filteredSchools = schools.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

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
                    <div key={school.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm relative overflow-hidden group hover:border-indigo-500 transition-colors">
                        <div className="absolute top-0 right-0 p-3">
                            <span className="px-2 py-1 text-[10px] font-bold uppercase rounded-full bg-indigo-50 text-indigo-700">
                                {school.frequencyTarget}
                            </span>
                        </div>

                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 mb-2 pr-12">{school.name}</h3>

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
                                    if (!Array.isArray(rules) || rules.length === 0) return <span className="text-xs text-gray-500">No specific windows set.</span>;

                                    return (
                                        <div className="space-y-2">
                                            {rules.map((rule: any, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-zinc-950 p-2 rounded-md border border-gray-100 dark:border-zinc-800">
                                                    <div className="flex items-center space-x-2">
                                                        <span className={`px-1.5 py-0.5 rounded font-bold ${rule.dayType ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400'}`}>
                                                            {rule.dayType ? `Day ${rule.dayType}` : rule.weekday.substr(0, 3)}
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
                                } catch (e) {
                                    return <div className="text-xs text-red-500 font-mono truncate">{school.availability}</div>;
                                }
                            })()}
                        </div>

                        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
                            <button
                                onClick={() => handleEditClick(school)}
                                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                            >
                                Edit Settings
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {editingSchool && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
                    <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 w-full max-w-lg border border-gray-100 dark:border-zinc-800 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100">Edit Settings: {editingSchool.name}</h3>
                            <button onClick={() => setEditingSchool(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency Target</label>
                                <select
                                    className="w-full border border-gray-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-950 focus:ring-2 focus:ring-indigo-500"
                                    value={editFormData.frequencyTarget}
                                    onChange={(e) => setEditFormData({ ...editFormData, frequencyTarget: e.target.value })}
                                >
                                    <option value="weekly">Weekly</option>
                                    <option value="bi-weekly">Bi-Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Availability Rules (JSON Array)</label>
                                <textarea
                                    className="w-full h-40 font-mono text-sm border border-gray-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-950 focus:ring-2 focus:ring-indigo-500"
                                    value={editFormData.availability}
                                    onChange={(e) => setEditFormData({ ...editFormData, availability: e.target.value })}
                                />
                            </div>

                            <div className="flex justify-end pt-4 space-x-2">
                                <button onClick={() => setEditingSchool(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-zinc-800">Cancel</button>
                                <button onClick={handleSaveEdit} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 flex items-center space-x-2">
                                    <Save size={16} /> <span>Save Changes</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
