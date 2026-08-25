"use client";



import { useEffect, useState } from "react";

import { getWeeklyPlan, getSchools, getSchoolOptionsForWeek, skipVisit } from "@/app/actions";

import { usePlannerStore } from "@/store/plannerStore";

import { format, addDays, subDays, startOfWeek } from "date-fns";

import { RefreshCw, MapPin, Clock, CheckCircle, ChevronLeft, ChevronRight, CalendarDays, Trash2, X, AlertCircle } from "lucide-react";

import { ViableOption } from "@/lib/types";

import ConfirmVisitModal from "./ConfirmVisitModal";

const FREQ_BADGE: Record<string, { label: string; cls: string }> = {
    WEEKLY: { label: "Weekly", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    BIWEEKLY: { label: "2-week", cls: "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400" },
    EVERY_3_WEEKS: { label: "3-week", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    MONTHLY: { label: "Monthly", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    DEFAULT: { label: "2-week", cls: "bg-gray-100 text-gray-400 dark:bg-zinc-800 dark:text-gray-500" },
};



export default function WeeklyPlanner({ regionFilter }: { regionFilter?: string | null }) {

    const { weekStartDateStr, setWeekStartDate, maxVisitsPerWeek, setMaxVisitsPerWeek, maxVisitsPerDay, setMaxVisitsPerDay, plannedVisits, setPlannedVisits, addOverride, manualOverrides, clearOverrides } = usePlannerStore();

    const weekStartDate = new Date(weekStartDateStr);
    // Sent to the server as a plain calendar date. An ISO instant would be
    // re-read in the host's zone there, and 8pm Monday in Miami is already
    // Tuesday in UTC — which selected the wrong week.
    const weekStartKey = format(startOfWeek(weekStartDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const [loading, setLoading] = useState(false);



    type PostponeData = { schoolId: string, visitDate: Date, schoolName: string, viableOptions: ViableOption[] };

    const [postponeModalData, setPostponeModalData] = useState<PostponeData | null>(null);



    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const [allSchools, setAllSchools] = useState<{ id: string, name: string }[]>([]);

    const [selectedSchoolIdForAdd, setSelectedSchoolIdForAdd] = useState<string>("");

    const [optionsForAdd, setOptionsForAdd] = useState<ViableOption[]>([]);

    const [loadingOptions, setLoadingOptions] = useState(false);



    type ConfirmModalData = { schoolId: string, schoolName: string, visitDate: Date, lat?: number, lng?: number, subjectName?: string };

    const [confirmModalData, setConfirmModalData] = useState<ConfirmModalData | null>(null);



    const fetchPlan = async () => {

        setLoading(true);
        const plan = await getWeeklyPlan(weekStartKey, manualOverrides, maxVisitsPerWeek, maxVisitsPerDay, regionFilter);
        setPlannedVisits(plan);
        setLoading(false);

    };



    const handleVisitConfirmed = (schoolId: string, visitDate: Date) => {

        // Locally mark it as completed to prevent full week reload

        setPlannedVisits(plannedVisits.map(v =>

            (v.schoolId === schoolId && format(new Date(v.date), 'yyyy-MM-dd') === format(visitDate, 'yyyy-MM-dd'))

                ? { ...v, isCompleted: true }

                : v

        ));

    };



    const handleNextWeek = () => setWeekStartDate(addDays(weekStartDate, 7));

    const handlePrevWeek = () => setWeekStartDate(subDays(weekStartDate, 7));



    const handleSkip = async (schoolId: string, visitDate: Date) => {

        addOverride({ schoolId, date: visitDate, isSkipped: true });

        try { await skipVisit(schoolId, visitDate.toISOString()); } catch (e) { console.error(e); }

        setPlannedVisits(plannedVisits.filter(v => !(v.schoolId === schoolId && format(new Date(v.date), 'yyyy-MM-dd') === format(visitDate, 'yyyy-MM-dd'))));

    };



    const handleOpenPostpone = (schoolId: string, visitDate: Date, schoolName: string, viableOptions: ViableOption[]) => {

        setPostponeModalData({ schoolId, visitDate, schoolName, viableOptions });

    };



    const handlePostponeToDay = (schoolId: string, originalDate: Date, targetDate: Date | null, startTime?: string, endTime?: string) => {

        addOverride({ schoolId, date: originalDate, isSkipped: true });



        const updatedVisits = [...plannedVisits];

        const oldIndex = updatedVisits.findIndex(v => v.schoolId === schoolId && format(new Date(v.date), 'yyyy-MM-dd') === format(originalDate, 'yyyy-MM-dd'));

        let movingVisit = null;



        if (oldIndex >= 0) {

            movingVisit = updatedVisits.splice(oldIndex, 1)[0];

        }



        if (targetDate) {

            addOverride({ schoolId, date: targetDate, isPinned: true, startTime, endTime });



            if (movingVisit) {

                updatedVisits.push({

                    ...movingVisit,

                    date: targetDate,

                    startTime: startTime || movingVisit.startTime,

                    endTime: endTime || movingVisit.endTime,

                    isPinned: true

                });



                // Keep everything sorted inside the day

                updatedVisits.sort((a, b) => {

                    const startA = a.startTime || "00:00";

                    const startB = b.startTime || "00:00";

                    const timeA = startA === "Done" ? Infinity : (Number(startA.split(':')[0]) * 60 + Number(startA.split(':')[1]));

                    const timeB = startB === "Done" ? Infinity : (Number(startB.split(':')[0]) * 60 + Number(startB.split(':')[1]));

                    return timeA - timeB;

                });

            }

        }



        setPlannedVisits(updatedVisits);

        setPostponeModalData(null);

    };



    const handleOpenAddModal = async () => {

        setIsAddModalOpen(true);

        if (allSchools.length === 0) {

            const schools = await getSchools(regionFilter);

            setAllSchools(schools.map(s => ({ id: s.id, name: s.name })));

        }

    };



    const handleAddSchoolChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {

        const id = e.target.value;

        setSelectedSchoolIdForAdd(id);

        if (!id) {

            setOptionsForAdd([]);

            return;

        }

        setLoadingOptions(true);

        const options = await getSchoolOptionsForWeek(id, weekStartKey);

        setOptionsForAdd(options);

        setLoadingOptions(false);

    };



    const handleAddVisitConfirm = async (rule: ViableOption) => {

        if (!selectedSchoolIdForAdd) return;



        const newOverride = {

            schoolId: selectedSchoolIdForAdd,

            date: new Date(rule.date + "T12:00:00Z"),

            isPinned: true,

            startTime: rule.rule.start,

            endTime: rule.rule.end

        };

        addOverride(newOverride);



        setIsAddModalOpen(false);

        setSelectedSchoolIdForAdd("");

        setOptionsForAdd([]);



        setLoading(true);

        const updatedOverrides = [...manualOverrides, newOverride];

        const plan = await getWeeklyPlan(weekStartKey, updatedOverrides, maxVisitsPerWeek, maxVisitsPerDay, regionFilter);

        setPlannedVisits(plan);

        setLoading(false);

    };



    useEffect(() => {

        let isMounted = true;

        const load = async () => {

            // Only auto-load if we don't already have a plan for this week.
            // Recalculate should be manual (button) to avoid wiping user adjustments when returning to tab.
            const currentWeekStr = format(startOfWeek(weekStartDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
            const hasPlanForThisWeek = plannedVisits.some(v =>
                format(startOfWeek(new Date(v.date), { weekStartsOn: 1 }), "yyyy-MM-dd") === currentWeekStr
            );

            if (hasPlanForThisWeek) return;

            setLoading(true);

            const plan = await getWeeklyPlan(weekStartKey, manualOverrides, maxVisitsPerWeek, maxVisitsPerDay, regionFilter);

            if (isMounted) {

                setPlannedVisits(plan);

                setLoading(false);

            }

        };

        load();

        return () => { isMounted = false; };

        // eslint-disable-next-line react-hooks/exhaustive-deps

    }, [weekStartDateStr, regionFilter, maxVisitsPerWeek, maxVisitsPerDay]);



    const days = Array.from({ length: 5 }).map((_, i) => addDays(startOfWeek(weekStartDate, { weekStartsOn: 1 }), i));



    return (

        <div className="p-6">

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 space-y-4 sm:space-y-0">

                <div className="flex items-center space-x-4">

                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Weekly Route Plan</h2>

                    <div className="flex items-center bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">

                        <button onClick={handlePrevWeek} disabled={loading} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">

                            <ChevronLeft size={18} className="text-gray-600 dark:text-gray-300" />

                        </button>

                        <span className="px-3 text-sm font-medium text-gray-700 dark:text-gray-300 border-x border-gray-200 dark:border-zinc-700">

                            {format(startOfWeek(weekStartDate, { weekStartsOn: 1 }), "MMM d")} - {format(addDays(startOfWeek(weekStartDate, { weekStartsOn: 1 }), 4), "MMM d")}

                        </span>

                        <button onClick={handleNextWeek} disabled={loading} className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">

                            <ChevronRight size={18} className="text-gray-600 dark:text-gray-300" />

                        </button>

                    </div>

                </div>

                <div className="flex items-center space-x-4">

                    <div className="flex items-center space-x-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5">

                        <label className="text-sm text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">Target Visits:</label>

                        <select

                            value={maxVisitsPerWeek}

                            onChange={(e) => setMaxVisitsPerWeek(Number(e.target.value))}

                            className="bg-transparent border-none text-sm font-bold text-gray-800 dark:text-gray-200 focus:ring-0 cursor-pointer"

                        >

                            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map(num => (

                                <option key={num} value={num}>{num} / week</option>

                            ))}

                        </select>

                    </div>

                    <div className="flex items-center space-x-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5">

                        <label className="text-sm text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">Per day:</label>

                        <select

                            value={maxVisitsPerDay}

                            onChange={(e) => setMaxVisitsPerDay(Number(e.target.value))}

                            className="bg-transparent border-none text-sm font-bold text-gray-800 dark:text-gray-200 focus:ring-0 cursor-pointer"

                        >

                            {[2, 3, 4, 5, 6, 7, 8].map(num => (

                                <option key={num} value={num}>max {num}</option>

                            ))}

                        </select>

                    </div>



                    <button

                        onClick={handleOpenAddModal}

                        disabled={loading}

                        className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shadow-sm"

                        title="Manually force an extra school into this week"

                    >

                        <span>+ Add</span>

                    </button>

                    <button

                        onClick={() => {

                            clearOverrides();

                            fetchPlan();

                        }}

                        disabled={loading}

                        className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shadow-sm"

                        title="Reset all manual changes and recalculate optimal route"

                    >

                        <RefreshCw size={18} className={loading ? "animate-spin" : ""} />

                        <span className="hidden sm:inline">Recalculate</span>

                    </button>

                </div>

            </div>



            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                {days.map((day, idx) => {

                    const formattedDate = format(day, "yyyy-MM-dd");

                    const toMins = (t?: string) => {
                        if (!t || t === "Done") return 999999;
                        const [h, m] = t.split(":").map(Number);
                        return (h ?? 0) * 60 + (m ?? 0);
                    };

                    const dayVisits = plannedVisits
                        .filter(v => format(new Date(v.date), "yyyy-MM-dd") === formattedDate)
                        .slice()
                        .sort((a, b) => toMins(a.startTime) - toMins(b.startTime));



                    return (

                        <div key={idx} className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm flex flex-col">

                            <div className="bg-gray-50 dark:bg-zinc-800/50 p-3 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center">

                                <div>

                                    <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{format(day, "EEEE")}</p>

                                    <p className="text-xs text-gray-400">{format(day, "MMM d")}</p>

                                </div>


                            </div>



                            <div className="p-3 flex-1 flex flex-col space-y-3">

                                {dayVisits.length === 0 ? (

                                    <div className="text-center py-8 text-gray-400 text-sm italic">

                                        No visits scheduled

                                    </div>

                                ) : (

                                    dayVisits.map((visit, vIdx) => {

                                        let dynamicWarning = visit.warning;



                                        if (visit.startTime && visit.startTime !== "Done" && visit.endTime && visit.endTime !== "Done") {

                                            const startMins = Number(visit.startTime.split(':')[0]) * 60 + Number(visit.startTime.split(':')[1]);

                                            const endMins = Number(visit.endTime.split(':')[0]) * 60 + Number(visit.endTime.split(':')[1]);



                                            const hasOverlap = dayVisits.some(other => {

                                                if (other.schoolId === visit.schoolId) return false;

                                                if (!other.startTime || other.startTime === "Done" || !other.endTime || other.endTime === "Done") return false;



                                                const oStart = Number(other.startTime.split(':')[0]) * 60 + Number(other.startTime.split(':')[1]);

                                                const oEnd = Number(other.endTime.split(':')[0]) * 60 + Number(other.endTime.split(':')[1]);



                                                return Math.max(startMins, oStart) < Math.min(endMins, oEnd);

                                            });



                                            if (hasOverlap) {

                                                dynamicWarning = "Heads up! These visits are close together or overlap. Make sure you have enough time.";

                                            } else {

                                                dynamicWarning = undefined;

                                            }

                                        }



                                        return (

                                            <div key={vIdx} className={`p-3 border rounded-lg shadow-sm ${visit.isCompleted ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/50' : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700'}`}>

                                                <div className="flex justify-between items-start mb-1">

                                                    <div>

                                                        <h4 className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-tight">{visit.schoolName}</h4>

                                                        {visit.subjectName && (

                                                            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium leading-tight">{visit.subjectName}</p>

                                                        )}

                                                    </div>

                                                    {visit.isCompleted ? (

                                                        <CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 ml-1" />

                                                    ) : visit.visitRuleFrequency ? (

                                                        <span
                                                            className={`shrink-0 ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${FREQ_BADGE[visit.visitRuleFrequency]?.cls ?? FREQ_BADGE.DEFAULT.cls}`}
                                                            title={visit.visitRuleNote ?? undefined}
                                                        >
                                                            {FREQ_BADGE[visit.visitRuleFrequency]?.label ?? visit.visitRuleFrequency}
                                                        </span>

                                                    ) : null}

                                                </div>



                                                <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-2 space-x-2">

                                                    <div className="flex items-center"><Clock size={12} className="mr-1" /> {visit.startTime} - {visit.endTime}</div>

                                                    <div className="flex items-center"><MapPin size={12} className="mr-1" /> {visit.zipCode}</div>

                                                </div>

                                                {/* The times above are the 20-minute drop-in. Showing the class it sits
                                                    inside makes clear whether you are catching the start or the end. */}
                                                {visit.classStartTime && visit.classEndTime && (
                                                    <div className="text-[11px] text-gray-400 dark:text-gray-500 -mt-1 mb-2">
                                                        Class runs {visit.classStartTime} - {visit.classEndTime}
                                                        {visit.startTime === visit.classStartTime
                                                            ? " · first 20 min"
                                                            : visit.endTime === visit.classEndTime
                                                                ? " · last 20 min"
                                                                : ""}
                                                    </div>
                                                )}



                                                <div className="flex justify-between items-start mt-3">

                                                    <div className="flex flex-col space-y-1.5 pt-1">

                                                        <p className="inline-block text-[11px] bg-gray-100 dark:bg-zinc-900/50 px-2.5 py-1 rounded text-gray-600 dark:text-gray-300 border border-dashed border-gray-300 dark:border-zinc-700 w-fit">

                                                            ⚡ {visit.reason}

                                                        </p>

                                                        {visit.noClassWarning && !visit.isCompleted && (

                                                            <p className="inline-flex items-center gap-1 text-[10px] leading-tight bg-red-50 dark:bg-red-950/30 px-2 py-1.5 rounded text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 w-fit font-medium">

                                                                <AlertCircle size={10} className="shrink-0" />

                                                                No class scheduled — admin / catch-up visit

                                                            </p>

                                                        )}

                                                        {visit.scheduleConflict && !visit.isCompleted && (

                                                            <p className="inline-flex items-center gap-1 text-[10px] leading-tight bg-orange-50 dark:bg-orange-950/30 px-2 py-1.5 rounded text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-900 w-fit font-medium">

                                                                <AlertCircle size={10} className="shrink-0" />

                                                                Can&apos;t reach on time from previous stop

                                                            </p>

                                                        )}

                                                        {dynamicWarning && (

                                                            <p className="inline-block text-[10px] leading-tight bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 rounded text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 w-fit font-medium max-w-[150px]">

                                                                ⚠️ {dynamicWarning}

                                                            </p>

                                                        )}

                                                    </div>



                                                    {!visit.isCompleted && (

                                                        <div className="flex space-x-2">

                                                            <button

                                                                onClick={() => setConfirmModalData({
                                                                    schoolId: visit.schoolId,
                                                                    schoolName: visit.schoolName,
                                                                    visitDate: new Date(visit.date),
                                                                    lat: visit.lat,
                                                                    lng: visit.lng,
                                                                    subjectName: visit.subjectName,
                                                                })}

                                                                disabled={loading}

                                                                title="Confirm Visit"

                                                                className="p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 rounded-lg transition-colors"

                                                            >

                                                                <CheckCircle size={16} />

                                                            </button>

                                                            <button

                                                                onClick={() => handleOpenPostpone(visit.schoolId, new Date(visit.date), visit.schoolName, visit.viableOptionsThisWeek || [])}

                                                                disabled={loading}

                                                                title="Postpone"

                                                                className="p-1.5 text-amber-600 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 rounded-lg transition-colors"

                                                            >

                                                                <CalendarDays size={16} />

                                                            </button>

                                                            <button

                                                                onClick={() => handleSkip(visit.schoolId, new Date(visit.date))}

                                                                disabled={loading}

                                                                title="Delete"

                                                                className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50 rounded-lg transition-colors"

                                                            >

                                                                <Trash2 size={16} />

                                                            </button>

                                                        </div>

                                                    )}

                                                </div>

                                            </div>

                                        )

                                    })

                                )}

                            </div>

                        </div>

                    );

                })}

            </div>



            {/* Confirm Visit Modal */}

            {confirmModalData && (

                <ConfirmVisitModal
                    schoolId={confirmModalData.schoolId}
                    schoolName={confirmModalData.schoolName}
                    visitDate={confirmModalData.visitDate}
                    schoolLat={confirmModalData.lat}
                    schoolLng={confirmModalData.lng}
                    subjectName={confirmModalData.subjectName}
                    onClose={() => setConfirmModalData(null)}
                    onConfirmed={() => handleVisitConfirmed(confirmModalData.schoolId, confirmModalData.visitDate)}
                />

            )}

            {/* Postpone Modal */}

            {postponeModalData && (

                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50 p-4">

                    <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">

                        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center bg-gray-50 dark:bg-zinc-800/50">

                            <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center">

                                <CalendarDays size={18} className="mr-2 text-amber-500" />

                                Postpone Visit

                            </h3>

                            <button onClick={() => setPostponeModalData(null)} className="text-gray-400 hover:text-gray-600 transition-colors">

                                <X size={18} />

                            </button>

                        </div>

                        <div className="p-5">

                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Select a new date for:</p>

                            <p className="font-semibold text-gray-800 dark:text-gray-100 mb-4">{postponeModalData.schoolName}</p>



                            <div className="space-y-2">

                                <p className="text-xs font-semibold uppercase text-indigo-600 dark:text-indigo-400 tracking-wider mb-2">This Week</p>

                                <div className="space-y-3">

                                    {days.filter(d => format(d, "yyyy-MM-dd") >= format(new Date(), "yyyy-MM-dd") && format(d, "yyyy-MM-dd") !== format(postponeModalData.visitDate, "yyyy-MM-dd")).map((day, idx) => {

                                        const dateStr = format(day, "yyyy-MM-dd");
                                        const norm = (s: string) => (s && String(s).slice(0, 10)) || "";
                                        const optionsForDay = postponeModalData.viableOptions.filter(o => norm(o.date) === dateStr);

                                        const isViable = optionsForDay.length > 0;

                                        return (

                                            <div key={idx} className="flex flex-col border border-gray-100 dark:border-zinc-800 rounded-lg p-2 bg-white dark:bg-zinc-800/20">

                                                <div className="flex justify-between items-center mb-1">

                                                    <span className="text-xs font-bold text-gray-500 uppercase">{format(day, "EEEE")}</span>

                                                    {!isViable && <span className="text-[10px] font-bold text-gray-400 uppercase">Not Available</span>}

                                                </div>

                                                {!isViable && (

                                                    <div className="h-8 border border-dashed border-gray-200 dark:border-zinc-700 rounded bg-gray-50/50 dark:bg-zinc-800/40"></div>

                                                )}

                                                {isViable && (

                                                    <div className="flex flex-col gap-2 mt-1">

                                                        {optionsForDay.length > 1 && (

                                                            <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Elegir sesión</p>

                                                        )}

                                                        {optionsForDay.map((opt, oIdx) => (

                                                            <button

                                                                key={`${dateStr}-${opt.rule.start}-${opt.rule.end}-${oIdx}`}

                                                                onClick={() => handlePostponeToDay(postponeModalData.schoolId, postponeModalData.visitDate, day, opt.rule.start, opt.rule.end)}

                                                                className="px-3 py-2 text-sm border rounded-lg hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-900/30 dark:hover:border-indigo-800 transition-colors text-left flex flex-col gap-0.5 border-gray-200 dark:border-zinc-700 font-medium"

                                                            >

                                                                <span className="font-medium text-gray-800 dark:text-gray-200">{opt.rule.class || 'Available Schedule'}</span>

                                                                <span className="text-xs text-gray-500 font-normal">{opt.rule.start} – {opt.rule.end}</span>

                                                            </button>

                                                        ))}

                                                    </div>

                                                )}

                                            </div>

                                        );

                                    })}

                                    {days.filter(d => format(d, "yyyy-MM-dd") >= format(new Date(), "yyyy-MM-dd") && format(d, "yyyy-MM-dd") !== format(postponeModalData.visitDate, "yyyy-MM-dd")).length === 0 && (

                                        <div className="text-xs italic text-gray-400 text-center py-4 border rounded-lg border-dashed">

                                            No remaining days this week.

                                        </div>

                                    )}

                                </div>



                                <div className="pt-3 mt-3 border-t border-gray-100 dark:border-zinc-800">

                                    <button

                                        onClick={() => handlePostponeToDay(postponeModalData.schoolId, postponeModalData.visitDate, null)}

                                        className="w-full px-3 py-2 text-sm font-semibold border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg transition-colors flex items-center justify-center space-x-2"

                                    >

                                        <span>Skip to Next Week</span>

                                        <ChevronRight size={14} />

                                    </button>

                                </div>

                            </div>

                        </div>

                    </div>

                </div>

            )}

            {/* ADD EXTRA VISIT MODAL */}

            {isAddModalOpen && (

                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">

                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-zinc-800">

                        <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-800/20">

                            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">

                                Add Extra Visit

                            </h3>

                            <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1">

                                <X size={20} />

                            </button>

                        </div>



                        <div className="p-5 space-y-4">

                            <p className="text-sm text-gray-500 dark:text-gray-400">

                                Select a school to view its available schedule for the current week.

                            </p>



                            <select

                                value={selectedSchoolIdForAdd}

                                onChange={handleAddSchoolChange}

                                className="w-full p-2.5 bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-emerald-500 outline-none"

                            >

                                <option value="">-- Select a School --</option>

                                {allSchools.map(s => (

                                    <option key={s.id} value={s.id}>{s.name}</option>

                                ))}

                            </select>



                            {selectedSchoolIdForAdd && (

                                <div className="pt-2 border-t border-gray-100 dark:border-zinc-800">

                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Available Times This Week</h4>

                                    {loadingOptions ? (

                                        <div className="text-sm text-gray-500 animate-pulse py-2">Loading schedules...</div>

                                    ) : optionsForAdd.length > 0 ? (

                                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">

                                            {optionsForAdd.filter(opt => {
                                                const d = (opt.date && String(opt.date).slice(0, 10)) || opt.date;
                                                return format(new Date(d + "T12:00:00Z"), 'yyyy-MM-dd') >= format(new Date(), 'yyyy-MM-dd');
                                            }).map((opt, i) => {

                                                const optDateStr = (opt.date && String(opt.date).slice(0, 10)) || opt.date;
                                                const optDate = new Date(optDateStr + "T12:00:00Z");

                                                return (

                                                    <button

                                                        key={`${optDateStr}-${opt.rule.start}-${opt.rule.end}-${i}`}

                                                        onClick={() => handleAddVisitConfirm(opt)}

                                                        className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-zinc-700 hover:border-emerald-500 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors group relative flex items-center justify-between"

                                                    >

                                                        <div>

                                                            <div className="font-semibold text-gray-800 dark:text-gray-200 text-sm">

                                                                {format(optDate, "EEEE, MMM d")}

                                                            </div>

                                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center">

                                                                <Clock size={12} className="mr-1 inline shrink-0" />

                                                                <span className="font-medium text-gray-700 dark:text-gray-300">{opt.rule.class || "Class"}</span>

                                                                <span className="ml-1">• {opt.rule.start} – {opt.rule.end}</span>

                                                            </div>

                                                        </div>

                                                    </button>

                                                );

                                            })}

                                            {optionsForAdd.filter(opt => {
                                                const d = (opt.date && String(opt.date).slice(0, 10)) || opt.date;
                                                return format(new Date(d + "T12:00:00Z"), 'yyyy-MM-dd') >= format(new Date(), 'yyyy-MM-dd');
                                            }).length === 0 && (

                                                <div className="text-sm text-gray-400 italic py-2">No future available slots in this week.</div>

                                            )}

                                        </div>

                                    ) : (

                                        <div className="space-y-3">

                                            <div className="text-sm text-gray-400 py-1 flex items-center gap-1.5">

                                                <AlertCircle size={14} className="text-red-400 shrink-0" />

                                                No class scheduled this week for this school.

                                            </div>

                                            <p className="text-xs text-gray-400">You can still visit for admin, paperwork, or a catch-up. Pick a day:</p>

                                            <div className="grid grid-cols-5 gap-1.5">

                                                {Array.from({ length: 5 }, (_, i) => addDays(startOfWeek(weekStartDate, { weekStartsOn: 1 }), i)).map((day, i) => {

                                                    const isFuture = format(day, "yyyy-MM-dd") >= format(new Date(), "yyyy-MM-dd");

                                                    return (

                                                        <button

                                                            key={i}

                                                            disabled={!isFuture}

                                                            onClick={() => handleAddVisitConfirm({ date: format(day, "yyyy-MM-dd"), rule: { start: "09:00", end: "10:00" } })}

                                                            className="p-2 text-xs rounded-lg border border-gray-200 dark:border-zinc-700 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 dark:hover:border-red-800 transition-colors text-center disabled:opacity-30 disabled:cursor-not-allowed font-medium text-gray-700 dark:text-gray-300"

                                                        >

                                                            {format(day, "EEE")}

                                                            <span className="block text-gray-400 font-normal">{format(day, "d")}</span>

                                                        </button>

                                                    );

                                                })}

                                            </div>

                                        </div>

                                    )}

                                </div>

                            )}

                        </div>

                    </div>

                </div>

            )}

        </div>

    );

}

