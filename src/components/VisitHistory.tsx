"use client";

import { useEffect, useState } from "react";
import { getVisitHistory, addManualVisit, getSchools, deleteVisitLog, editVisitLog, getQuarters } from "@/app/actions";
import { format } from "date-fns";
import { History, Plus, CheckCircle, Database, Edit2, Trash2, Download } from "lucide-react";

export default function VisitHistory({ regionFilter }: { regionFilter?: string | null }) {
    const [history, setHistory] = useState<any[]>([]);
    const [schools, setSchools] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterMonth, setFilterMonth] = useState<string>(new Date().getMonth().toString());

    const [quarters, setQuarters] = useState<{ id: string; schoolYear: string; label: string }[]>([]);
    const [selectedQuarterKey, setSelectedQuarterKey] = useState<string>("");
    const [reportFormat, setReportFormat] = useState<"csv" | "pdf">("csv");

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedSchool, setSelectedSchool] = useState("");
    const [visitDate, setVisitDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [notes, setNotes] = useState("");

    const fetchHistory = async () => {
        setLoading(true);
        const [logs, schoolsData] = await Promise.all([
            getVisitHistory(regionFilter),
            getSchools(regionFilter)
        ]);
        setHistory(logs);
        setSchools(schoolsData);
        setLoading(false);
    };

    useEffect(() => {
        fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [regionFilter]);

    useEffect(() => {
        getQuarters().then((q) => {
            setQuarters(q);
            if (q.length > 0) setSelectedQuarterKey(`${q[0].schoolYear}|${q[0].label}`);
        });
    }, []);

    const reportUrl = (() => {
        if (!selectedQuarterKey) return null;
        const [schoolYear, label] = selectedQuarterKey.split("|");
        const params = new URLSearchParams({ schoolYear, quarter: label, format: reportFormat });
        if (regionFilter) params.set("regionId", regionFilter);
        return `/api/reports/mileage?${params.toString()}`;
    })();

    const handleOpenAdd = () => {
        setEditingId(null);
        setSelectedSchool("");
        setVisitDate(format(new Date(), "yyyy-MM-dd"));
        setNotes("");
        setShowModal(true);
    };

    const handleOpenEdit = (log: any) => {
        setEditingId(log.id);
        setSelectedSchool(log.schoolId);
        setVisitDate(format(new Date(log.date), "yyyy-MM-dd"));
        setNotes(log.notes || "");
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this visit log?")) return;
        setLoading(true);
        await deleteVisitLog(id);
        await fetchHistory();
    };

    const handleSave = async () => {
        if (!selectedSchool || !visitDate) return;
        setLoading(true);
        const isoDate = new Date(visitDate + "T12:00:00Z").toISOString();

        if (editingId) {
            await editVisitLog(editingId, isoDate, notes);
        } else {
            await addManualVisit(selectedSchool, isoDate, notes || "Manual logging");
        }

        setShowModal(false);
        setEditingId(null);
        setSelectedSchool("");
        setNotes("");
        await fetchHistory();
    };

    const filteredHistory = history.filter(log => {
        if (filterMonth === "all") return true;
        const logMonth = new Date(log.date).getMonth().toString();
        return logMonth === filterMonth;
    });

    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    return (
        <div className="p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 space-y-4 sm:space-y-0">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <History className="mr-2 text-indigo-600 dark:text-indigo-400" />
                        Visit History
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Review your completed visits and register new ones manually.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <select
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="all">All Time</option>
                        {months.map((m, i) => (
                            <option key={i} value={i.toString()}>{m}</option>
                        ))}
                    </select>

                    {quarters.length > 0 && (
                        <>
                            <select
                                value={selectedQuarterKey}
                                onChange={(e) => setSelectedQuarterKey(e.target.value)}
                                className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-indigo-500"
                                title="Mileage report quarter"
                            >
                                {quarters.map((q) => (
                                    <option key={q.id} value={`${q.schoolYear}|${q.label}`}>
                                        {q.schoolYear} {q.label}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={reportFormat}
                                onChange={(e) => setReportFormat(e.target.value as "csv" | "pdf")}
                                className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="csv">CSV</option>
                                <option value="pdf">PDF</option>
                            </select>
                            <a
                                href={reportUrl ?? "#"}
                                className="flex items-center justify-center space-x-2 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg font-medium transition-colors"
                                title="Download mileage report"
                            >
                                <Download size={16} />
                                <span>Report</span>
                            </a>
                        </>
                    )}

                    <button
                        onClick={handleOpenAdd}
                        className="flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex-1 sm:flex-none"
                    >
                        <Plus size={18} />
                        <span>Log Visit</span>
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-12 text-gray-500">Loading history...</div>
            ) : (
                <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-600 dark:text-gray-300">
                                <tr>
                                    <th className="px-6 py-4 font-semibold">Date</th>
                                    <th className="px-6 py-4 font-semibold">School</th>
                                    <th className="px-6 py-4 font-semibold">Notes / Reason</th>
                                    <th className="px-6 py-4 font-semibold">Status</th>
                                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                                {filteredHistory.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                            No visit history found for this period.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredHistory.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-800 dark:text-gray-200">
                                                {format(new Date(log.date), "MMM d, yyyy")}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                                                {log.school.name}
                                            </td>
                                            <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                                                {log.notes}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="inline-flex items-center px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-bold">
                                                    <CheckCircle size={12} className="mr-1" /> Completed
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                <button onClick={() => handleOpenEdit(log)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-3">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(log.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Manual Log Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
                    <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-xl shadow-xl overflow-hidden border border-gray-100 dark:border-zinc-800">
                        <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100">
                                {editingId ? "Edit Visit Log" : "Log Manual Visit"}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">School</label>
                                <select
                                    value={selectedSchool}
                                    onChange={(e) => setSelectedSchool(e.target.value)}
                                    disabled={!!editingId}
                                    className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                >
                                    <option value="" disabled>Select a school...</option>
                                    {schools.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
                                <input
                                    type="date"
                                    value={visitDate}
                                    onChange={(e) => setVisitDate(e.target.value)}
                                    className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-gray-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (Optional)</label>
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="e.g. Non-evaluative activity"
                                    className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-gray-100"
                                />
                            </div>
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-zinc-800/50 flex justify-end space-x-3">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">Cancel</button>
                            <button onClick={handleSave} disabled={loading || !selectedSchool || !visitDate} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50">
                                {editingId ? "Save Changes" : "Save Record"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
