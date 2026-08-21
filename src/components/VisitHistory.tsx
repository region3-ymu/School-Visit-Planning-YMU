"use client";

import { useEffect, useState } from "react";
import {
    getVisitHistory, addManualVisit, getSchools, getOtherRegionSchools,
    deleteVisitLog, editVisitLog, getQuarters, getMyHomeLocation, setMyHomeLocation,
    closeMyDay, getMyDayStatus, getOfficeLocations,
    type DayEndRoute,
} from "@/app/actions";
import { format, isToday } from "date-fns";
import { History, Plus, CheckCircle, Edit2, Trash2, Download, Car, Loader2 } from "lucide-react";
import OriginPicker, { type OriginMode } from "./visit/OriginPicker";
import TeacherObservationFields, {
    EMPTY_OBSERVATIONS,
    type ObservationDomainKey,
    type ObservationRating,
    type ObservationSkipReason,
    type ObservationState,
} from "./visit/TeacherObservationFields";

const VISITED_WITH_OPTIONS: { value: string; label: string }[] = [
    { value: "PRINCIPAL", label: "Principal" },
    { value: "MAIN_OFFICE", label: "Main Office" },
    { value: "INSCHOOL_MUSIC_TEACHER", label: "In-school music teacher" },
    { value: "YMU_TEACHER", label: "YMU teacher" },
];

const TALK_ABOUT_TRIGGERS = ["PRINCIPAL", "MAIN_OFFICE", "INSCHOOL_MUSIC_TEACHER"];

// Derived from the server actions so the columns below can't drift from what
// the query actually selects.
type VisitLogRow = Awaited<ReturnType<typeof getVisitHistory>>[number];
type SchoolOption = Awaited<ReturnType<typeof getSchools>>[number];

export default function VisitHistory({ regionFilter }: { regionFilter?: string | null }) {
    const [history, setHistory] = useState<VisitLogRow[]>([]);
    const [schools, setSchools] = useState<SchoolOption[]>([]);
    const [otherSchools, setOtherSchools] = useState<{ id: string; name: string; regionName: string }[]>([]);
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

    const [mode, setMode] = useState<"IN_PERSON" | "ONLINE" | "PHONE">("IN_PERSON");
    const [originMode, setOriginMode] = useState<OriginMode>("home");
    const [homeAddress, setHomeAddress] = useState("");
    const [savedHome, setSavedHome] = useState<{ address: string; lat: number; lng: number } | null>(null);
    const [homeSaveStatus, setHomeSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [customAddress, setCustomAddress] = useState("");
    const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [gpsError, setGpsError] = useState<string | null>(null);
    const [gpsLoading, setGpsLoading] = useState(false);

    const [visitedWith, setVisitedWith] = useState<string[]>([]);
    const [principalNotes, setPrincipalNotes] = useState("");
    const [hasInstrumentRequest, setHasInstrumentRequest] = useState(false);
    const [instrumentRequestDetails, setInstrumentRequestDetails] = useState("");
    const [observations, setObservations] = useState<ObservationState>(EMPTY_OBSERVATIONS);
    const [obsNotes, setObsNotes] = useState("");
    const [obsSkipReason, setObsSkipReason] = useState<ObservationSkipReason | null>(null);
    const [obsSkipNotes, setObsSkipNotes] = useState("");
    const [isLastStop, setIsLastStop] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    type Office = Awaited<ReturnType<typeof getOfficeLocations>>[number];
    const [office, setOffice] = useState<Office | null>(null);
    const [dayEndRoute, setDayEndRoute] = useState<DayEndRoute>("home");

    const [dayStatus, setDayStatus] = useState<Awaited<ReturnType<typeof getMyDayStatus>> | null>(null);
    const [closingDay, setClosingDay] = useState(false);

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
        // Keyed off the signed-in user's own region, not the admin regionFilter, so
        // this only needs to run once. Empty for admins, who already see every school.
        getOtherRegionSchools().then(setOtherSchools);
        getMyHomeLocation().then((home) => {
            if (home) {
                setSavedHome(home);
                setHomeAddress(home.address);
            }
        });
        getMyDayStatus(new Date().toISOString()).then(setDayStatus);
        getOfficeLocations().then((list) => setOffice(list[0] ?? null));
    }, []);

    // Which of the two pickers owns the current selection — derived, so editing an
    // existing log lights up the right one without extra state to keep in sync.
    const isOtherRegionPick = otherSchools.some(s => s.id === selectedSchool);
    const isOfficePick = !!office && office.id === selectedSchool;

    const isRemote = mode !== "IN_PERSON";
    const showTalkAbout = visitedWith.some((v) => TALK_ABOUT_TRIGGERS.includes(v));
    // No classroom at the office, so the rubric stays out of an office stop even
    // if "YMU teacher" got ticked.
    const showTeacherObservation = !isRemote && !isOfficePick && visitedWith.includes("YMU_TEACHER");
    // A past date can't use "where I am now" as the origin — today's position says
    // nothing about where the RM drove from last Tuesday.
    const allowGps = isToday(new Date(visitDate + "T12:00:00"));

    const toggleVisitedWith = (value: string) =>
        setVisitedWith((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

    const setObservation = (key: ObservationDomainKey, value: ObservationRating) =>
        setObservations((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));

    const otherSchoolsByRegion = otherSchools.reduce<Record<string, typeof otherSchools>>((acc, s) => {
        (acc[s.regionName] ||= []).push(s);
        return acc;
    }, {});

    // Where the day ends. Offered wherever a return leg gets booked, so the two
    // entry points can't drift apart.
    const dayEndOptions: { value: DayEndRoute; label: string }[] = [
        { value: "home", label: "Home" },
        ...(office
            ? ([
                  { value: "office-home" as const, label: "Office, then home" },
                  { value: "office" as const, label: "Office" },
              ])
            : []),
    ];

    const renderDayEndPicker = () => {
        if (dayEndOptions.length < 2) return null;
        return (
            <div className="flex flex-wrap gap-1.5">
                {dayEndOptions.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDayEndRoute(opt.value)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            dayEndRoute === opt.value
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300"
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        );
    };

    const reportUrl = (() => {
        if (!selectedQuarterKey) return null;
        const [schoolYear, label] = selectedQuarterKey.split("|");
        const params = new URLSearchParams({ schoolYear, quarter: label, format: reportFormat });
        if (regionFilter) params.set("regionId", regionFilter);
        return `/api/reports/mileage?${params.toString()}`;
    })();

    const resetForm = () => {
        setSelectedSchool("");
        setNotes("");
        setMode("IN_PERSON");
        setOriginMode("home");
        setCustomAddress("");
        setVisitedWith([]);
        setPrincipalNotes("");
        setHasInstrumentRequest(false);
        setInstrumentRequestDetails("");
        setObservations(EMPTY_OBSERVATIONS);
        setObsNotes("");
        setObsSkipReason(null);
        setObsSkipNotes("");
        setIsLastStop(false);
        setDayEndRoute("home");
        setFormError(null);
    };

    const handleOpenAdd = () => {
        setEditingId(null);
        resetForm();
        setVisitDate(format(new Date(), "yyyy-MM-dd"));
        setShowModal(true);
    };

    const requestGps = () => {
        if (!navigator.geolocation) {
            setGpsError("Geolocation is not supported by this browser");
            return;
        }
        setGpsLoading(true);
        setGpsError(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setGpsLoading(false);
            },
            (err) => {
                setGpsError(err.message || "Could not get your location");
                setGpsLoading(false);
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    };

    const handleSaveHome = async () => {
        if (!homeAddress.trim()) return;
        setHomeSaveStatus("saving");
        try {
            const saved = await setMyHomeLocation(homeAddress);
            setSavedHome(saved);
            setHomeAddress(saved.address);
            setHomeSaveStatus("saved");
        } catch {
            setHomeSaveStatus("error");
        }
    };

    const handleCloseDay = async () => {
        setClosingDay(true);
        try {
            await closeMyDay(new Date().toISOString(), dayEndRoute);
            setDayStatus(await getMyDayStatus(new Date().toISOString()));
            await fetchHistory();
        } finally {
            setClosingDay(false);
        }
    };

    const handleOpenEdit = (log: VisitLogRow) => {
        setEditingId(log.id);
        resetForm();
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
        setFormError(null);

        if (hasInstrumentRequest && !instrumentRequestDetails.trim()) {
            setFormError("Please describe the instrument request or repair needed.");
            return;
        }

        setLoading(true);
        const isoDate = new Date(visitDate + "T12:00:00Z").toISOString();

        try {
            if (editingId) {
                await editVisitLog(editingId, isoDate, notes);
            } else {
                // Only the first in-person visit of the day needs an origin; the server
                // chains later ones from the previous stop and ignores what we send.
                let origin: { lat: number; lng: number; label?: string } | undefined;
                if (!isRemote) {
                    if (originMode === "gps") {
                        if (!gpsCoords) throw new Error("Still waiting on your location — pick Home or Other address instead.");
                        origin = { ...gpsCoords, label: "Current location" };
                    } else if (originMode === "office") {
                        if (!office?.lat || !office.lng) throw new Error("The office has no saved location.");
                        origin = { lat: office.lat, lng: office.lng, label: office.name };
                    } else if (originMode === "home" && savedHome && homeAddress.trim() === savedHome.address) {
                        origin = { lat: savedHome.lat, lng: savedHome.lng, label: "Home" };
                    } else {
                        const address = originMode === "home" ? homeAddress.trim() : customAddress.trim();
                        if (address) {
                            const res = await fetch("/api/routing/geocode", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ address }),
                            });
                            const geo = await res.json();
                            if (!res.ok) throw new Error(geo.error ?? "Could not find that address");
                            origin = { lat: geo.lat, lng: geo.lng, label: originMode === "home" ? "Home" : geo.label };
                        }
                    }
                }

                await addManualVisit(selectedSchool, isoDate, {
                    mode,
                    origin,
                    notes: notes.trim() || undefined,
                    visitedWith,
                    principalNotes: showTalkAbout ? principalNotes.trim() || undefined : undefined,
                    hasInstrumentRequest,
                    instrumentRequestDetails: hasInstrumentRequest ? instrumentRequestDetails.trim() : undefined,
                    obsPlanningPrep: observations.obsPlanningPrep ?? undefined,
                    obsCultureManagement: observations.obsCultureManagement ?? undefined,
                    obsInstructionMusicianship: observations.obsInstructionMusicianship ?? undefined,
                    obsEngagementEvidence: observations.obsEngagementEvidence ?? undefined,
                    obsProfessionalismGrowth: observations.obsProfessionalismGrowth ?? undefined,
                    obsNotes: showTeacherObservation && !obsSkipReason ? obsNotes.trim() || undefined : undefined,
                    obsSkipReason: showTeacherObservation ? obsSkipReason ?? undefined : undefined,
                    obsSkipNotes: showTeacherObservation && obsSkipReason ? obsSkipNotes.trim() || undefined : undefined,
                });

                // Books the drive home for the day being logged, which is not
                // necessarily today — the "End my day" button only ever closes
                // today, so back-filling a past day depends on this.
                if (isLastStop && !isRemote) {
                    await closeMyDay(isoDate, dayEndRoute);
                }
            }
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to save the visit");
            setLoading(false);
            return;
        }

        setShowModal(false);
        setEditingId(null);
        resetForm();
        setDayStatus(await getMyDayStatus(new Date().toISOString()));
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

            {dayStatus && dayStatus.inPersonCount > 0 && (
                <div className="mb-4 rounded-xl border border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Car size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <div className="text-sm">
                            <p className="font-medium text-gray-800 dark:text-gray-100">
                                Today: {dayStatus.visitCount} visit{dayStatus.visitCount === 1 ? "" : "s"},{" "}
                                {dayStatus.totalMiles.toFixed(1)} miles
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {dayStatus.closed
                                    ? `${dayStatus.outboundMiles.toFixed(1)} out + ${dayStatus.returnMiles.toFixed(1)} back home`
                                    : "The drive home isn't counted yet."}
                            </p>
                        </div>
                    </div>
                    {dayStatus.closed ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 px-3 py-2">
                            <CheckCircle size={14} /> Day closed
                        </span>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2">
                            {renderDayEndPicker()}
                        <button
                            onClick={handleCloseDay}
                            disabled={closingDay}
                            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            title="Adds the drive from your last school back home"
                        >
                            {closingDay && <Loader2 size={14} className="animate-spin" />}
                            End my day
                        </button>
                        </div>
                    )}
                </div>
            )}

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
                                    <th className="px-6 py-4 font-semibold">Miles</th>
                                    <th className="px-6 py-4 font-semibold">Notes / Reason</th>
                                    <th className="px-6 py-4 font-semibold">Status</th>
                                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                                {filteredHistory.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
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
                                                {log.otherRegionName && (
                                                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs font-semibold align-middle">
                                                        {log.otherRegionName}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-700 dark:text-gray-300">
                                                {log.milesDriven == null && log.returnMilesDriven == null ? (
                                                    <span className="text-gray-400">—</span>
                                                ) : (
                                                    <span title={log.originLabel ? `From ${log.originLabel}` : undefined}>
                                                        {((log.milesDriven ?? 0) + (log.returnMilesDriven ?? 0)).toFixed(1)}
                                                        {log.returnMilesDriven != null && (
                                                            <span className="text-xs text-gray-400 ml-1">incl. return</span>
                                                        )}
                                                    </span>
                                                )}
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
                    <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-xl shadow-xl overflow-hidden border border-gray-100 dark:border-zinc-800 max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100">
                                {editingId ? "Edit Visit Log" : "Log Manual Visit"}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div className={otherSchools.length > 0 ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : ""}>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">School</label>
                                    <select
                                        value={isOtherRegionPick ? "" : selectedSchool}
                                        onChange={(e) => setSelectedSchool(e.target.value)}
                                        disabled={!!editingId}
                                        className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                    >
                                        <option value="">Select a school...</option>
                                        {schools.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                        {office && (
                                            <optgroup label="Not a school">
                                                <option value={office.id}>{office.name}</option>
                                            </optgroup>
                                        )}
                                    </select>
                                </div>
                                {otherSchools.length > 0 && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Other region school</label>
                                        <select
                                            value={isOtherRegionPick ? selectedSchool : ""}
                                            onChange={(e) => setSelectedSchool(e.target.value)}
                                            disabled={!!editingId}
                                            className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                                        >
                                            <option value="">None — use my region</option>
                                            {Object.entries(otherSchoolsByRegion).map(([regionName, list]) => (
                                                <optgroup key={regionName} label={regionName}>
                                                    {list.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                            {isOtherRegionPick && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
                                    Logging a visit outside your region ({otherSchools.find(s => s.id === selectedSchool)?.regionName}).
                                </p>
                            )}
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

                            {/* Editing only ever changed the date and the note, so the rest of
                                the form stays out of the way in that mode. */}
                            {!editingId && (
                                <>
                                    <div>
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">How did this visit happen?</p>
                                        <div className="flex gap-2">
                                            {([
                                                { value: "IN_PERSON", label: "In person" },
                                                { value: "ONLINE", label: "Online" },
                                                { value: "PHONE", label: "Phone call" },
                                            ] as const).map((opt) => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => setMode(opt.value)}
                                                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                                        mode === opt.value
                                                            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                                                            : "border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400"
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                        {isRemote && (
                                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                                No mileage for this visit, since you didn&apos;t travel.
                                            </p>
                                        )}
                                    </div>

                                    {!isRemote && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                Where did you drive from?
                                            </p>
                                            <OriginPicker
                                                mode={originMode}
                                                onModeChange={setOriginMode}
                                                homeAddress={homeAddress}
                                                onHomeAddressChange={(v) => { setHomeAddress(v); setHomeSaveStatus("idle"); }}
                                                onSaveHome={handleSaveHome}
                                                homeSaveStatus={homeSaveStatus}
                                                customAddress={customAddress}
                                                onCustomAddressChange={setCustomAddress}
                                                gpsCoords={gpsCoords}
                                                gpsError={gpsError}
                                                gpsLoading={gpsLoading}
                                                onRequestGps={requestGps}
                                                allowGps={allowGps}
                                                office={office}
                                            />
                                            <p className="text-xs text-gray-400 mt-1">
                                                Only used if this is your first visit that day — later ones chain from the
                                                previous school automatically.
                                            </p>
                                        </div>
                                    )}

                                    <div>
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Who did you visit?</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {VISITED_WITH_OPTIONS.map((opt) => (
                                                <label
                                                    key={opt.value}
                                                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 cursor-pointer text-gray-700 dark:text-gray-300"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={visitedWith.includes(opt.value)}
                                                        onChange={() => toggleVisitedWith(opt.value)}
                                                    />
                                                    {opt.label}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {showTalkAbout && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">What did you talk about?</p>
                                            <textarea
                                                placeholder="Events? Concerts? (school&apos;s or YMU&apos;s?) Dates?"
                                                value={principalNotes}
                                                onChange={(e) => setPrincipalNotes(e.target.value)}
                                                rows={2}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                                            />
                                        </div>
                                    )}

                                    {showTeacherObservation && (
                                        <TeacherObservationFields
                                            observations={observations}
                                            onObservationChange={setObservation}
                                            notes={obsNotes}
                                            onNotesChange={setObsNotes}
                                            skipReason={obsSkipReason}
                                            onSkipReasonChange={setObsSkipReason}
                                            skipNotes={obsSkipNotes}
                                            onSkipNotesChange={setObsSkipNotes}
                                        />
                                    )}

                                    <div>
                                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={hasInstrumentRequest}
                                                onChange={(e) => setHasInstrumentRequest(e.target.checked)}
                                            />
                                            There&apos;s an instrument request or repair needed
                                        </label>
                                        {hasInstrumentRequest && (
                                            <textarea
                                                placeholder="Details (instrument, quantity, issue)"
                                                value={instrumentRequestDetails}
                                                onChange={(e) => setInstrumentRequestDetails(e.target.value)}
                                                rows={2}
                                                className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                                            />
                                        )}
                                    </div>

                                    {!isRemote && (
                                        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3">
                                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={isLastStop}
                                                    onChange={(e) => setIsLastStop(e.target.checked)}
                                                />
                                                This was my last stop that day
                                            </label>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                                                Adds the drive from this school back home. Tick it on the last visit
                                                when you&apos;re logging a whole day after the fact.
                                            </p>
                                            {isLastStop && dayEndOptions.length > 1 && (
                                                <div className="mt-2 ml-6">
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Where did you go after?</p>
                                                    {renderDayEndPicker()}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-zinc-800/50 flex justify-end space-x-3 shrink-0">
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
