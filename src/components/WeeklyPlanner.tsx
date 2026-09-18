"use client";



import { useEffect, useState } from "react";

import { getWeeklyPlan, getSchools, getSchoolOptionsForWeek, getManualVisit, skipVisit } from "@/app/actions";

import { usePlannerStore } from "@/store/plannerStore";

import { format, addDays, subDays, startOfWeek } from "date-fns";

// Day keys are Miami's, not the browser's. The server plans, skips and pins by
// Miami calendar day, and a day key built with date-fns format() is the
// viewer's — the two agreed only by luck, and stopped agreeing for anything
// scheduled late enough in the evening to already be tomorrow in UTC.
import { addDaysToDayKey, dayKeyInAppZone } from "@/lib/timezone";

import { RefreshCw, MapPin, Clock, CheckCircle, ChevronLeft, ChevronRight, CalendarDays, Trash2, X, AlertCircle } from "lucide-react";

import { ViableOption, VisitInfo } from "@/lib/types";

import ConfirmVisitModal from "./ConfirmVisitModal";

const FREQ_BADGE: Record<string, { label: string; cls: string }> = {
    WEEKLY: { label: "Weekly", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    BIWEEKLY: { label: "2-week", cls: "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400" },
    EVERY_3_WEEKS: { label: "3-week", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    MONTHLY: { label: "Monthly", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    DEFAULT: { label: "2-week", cls: "bg-gray-100 text-gray-400 dark:bg-zinc-800 dark:text-gray-500" },
};



export default function WeeklyPlanner({
    regionFilter,
    // False for the oversight roles, who read the plan without changing it
    // (permissions.ts, tabsForRole). The server refuses their writes either
    // way — confirmVisit, skipVisit, addManualVisit and reorderDayVisits all
    // throw for a role canPlanVisits() rejects — so this is not the lock. It
    // is what stops the screen from OFFERING four buttons that would each
    // fail, which reads as a broken app rather than as one that is not theirs.
    canPlan = true,
}: {
    regionFilter?: string | null;
    canPlan?: boolean;
}) {

    const { weekStartDateStr, setWeekStartDate, maxVisitsPerWeek, setMaxVisitsPerWeek, maxVisitsPerDay, setMaxVisitsPerDay, plannedVisits, setPlannedVisits, plannedFor, setPlan, addOverride, manualOverrides, clearOverrides } = usePlannerStore();

    const weekStartDate = new Date(weekStartDateStr);
    // Sent to the server as a plain calendar date. An ISO instant would be
    // re-read in the host's zone there, and 8pm Monday in Miami is already
    // Tuesday in UTC — which selected the wrong week.
    const weekStartKey = format(startOfWeek(weekStartDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

    // Mon-Fri as Miami calendar days. Kept as keys rather than Date objects
    // because that is what every comparison below is really about — which
    // column a visit belongs in — and a Date carries a time of day that only
    // ever gets in the way of that.
    const weekDayKeys = Array.from({ length: 5 }, (_, i) => addDaysToDayKey(weekStartKey, i));
    const todayKey = dayKeyInAppZone(new Date());

    /** The Miami calendar day a visit falls on. */
    const dayKeyOf = (date: Date | string) => dayKeyInAppZone(new Date(date));

    // Noon local, purely so date-fns can name the weekday and the date without
    // a midnight instant tipping over a zone boundary while it does.
    const labelDateFor = (dayKey: string) => new Date(`${dayKey}T12:00:00`);

    // What a plan on screen is a plan FOR. When this changes the plan is stale
    // and is refetched; when it doesn't, coming back to the tab leaves the
    // week exactly as the user left it.
    const planKey = [weekStartKey, regionFilter ?? "own", maxVisitsPerWeek, maxVisitsPerDay].join("|");

    const [loading, setLoading] = useState(false);



    type PostponeData = { schoolId: string, visitDate: Date, schoolName: string, viableOptions: ViableOption[] };

    const [postponeModalData, setPostponeModalData] = useState<PostponeData | null>(null);



    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const [allSchools, setAllSchools] = useState<{ id: string, name: string }[]>([]);

    const [selectedSchoolIdForAdd, setSelectedSchoolIdForAdd] = useState<string>("");

    const [optionsForAdd, setOptionsForAdd] = useState<ViableOption[]>([]);

    const [loadingOptions, setLoadingOptions] = useState(false);



    type ConfirmModalData = { schoolId: string, schoolName: string, visitDate: Date, lat?: number, lng?: number, subjectName?: string, subjectId?: string, teacherId?: string, teacherName?: string };

    const [confirmModalData, setConfirmModalData] = useState<ConfirmModalData | null>(null);



    // Overrides are passed in, never read from the closure. "Recalculate"
    // clears them and refetches in the same handler, and a zustand setter does
    // not update a closure that has already been created — so the "cleared"
    // recalculation was still being sent the old pins and skips, and came back
    // with the manual changes it had just been told to forget.
    const fetchPlan = async (overrides: Partial<VisitInfo>[]) => {

        setLoading(true);
        const plan = await getWeeklyPlan(weekStartKey, overrides, maxVisitsPerWeek, maxVisitsPerDay, regionFilter);
        setPlan(plan, planKey);
        setLoading(false);

    };



    const handleVisitConfirmed = (schoolId: string, visitDate: Date) => {

        // Locally mark it as completed to prevent full week reload

        setPlannedVisits(plannedVisits.map(v =>

            (v.schoolId === schoolId && dayKeyOf(v.date) === dayKeyOf(visitDate))

                ? { ...v, isCompleted: true }

                : v

        ));

    };



    const handleNextWeek = () => setWeekStartDate(addDays(weekStartDate, 7));

    const handlePrevWeek = () => setWeekStartDate(subDays(weekStartDate, 7));



    const handleSkip = async (schoolId: string, visitDate: Date) => {

        addOverride({ schoolId, date: visitDate, isSkipped: true });

        try { await skipVisit(schoolId, visitDate.toISOString()); } catch (e) { console.error(e); }

        setPlannedVisits(plannedVisits.filter(v => !(v.schoolId === schoolId && dayKeyOf(v.date) === dayKeyOf(visitDate))));

    };



    const handleOpenPostpone = (schoolId: string, visitDate: Date, schoolName: string, viableOptions: ViableOption[]) => {

        setPostponeModalData({ schoolId, visitDate, schoolName, viableOptions });

    };



    // The target is a Miami day key, not a Date: the override it becomes is
    // read back on the server as a calendar day, and handing it a Date carrying
    // the browser's current time of day is how a visit moved to a Thursday
    // could be filed under the Wednesday.
    const handlePostponeToDay = (schoolId: string, originalDate: Date, targetDayKey: string | null, startTime?: string, endTime?: string) => {

        // Order matters, and the store relies on it: the skip is recorded
        // first, and it clears any pin that was holding this school on this day
        // — otherwise a hand-added visit that is then moved stays pinned to
        // both days and shows up twice.
        addOverride({ schoolId, date: originalDate, isSkipped: true });



        const updatedVisits = [...plannedVisits];

        const oldIndex = updatedVisits.findIndex(v => v.schoolId === schoolId && dayKeyOf(v.date) === dayKeyOf(originalDate));

        let movingVisit = null;



        if (oldIndex >= 0) {

            movingVisit = updatedVisits.splice(oldIndex, 1)[0];

        }



        if (targetDayKey) {

            // Midday UTC is inside the Miami day whatever the offset, so the
            // server reads back the day that was clicked.
            const targetDate = new Date(`${targetDayKey}T12:00:00Z`);

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

        const schoolId = selectedSchoolIdForAdd;

        const dayKey = String(rule.date).slice(0, 10);



        addOverride({

            schoolId,

            // Midday UTC: inside the Miami day whatever the offset, so the
            // server reads back the day that was clicked.

            date: new Date(dayKey + "T12:00:00Z"),

            isPinned: true,

            startTime: rule.rule.start,

            endTime: rule.rule.end

        });



        setIsAddModalOpen(false);

        setSelectedSchoolIdForAdd("");

        setOptionsForAdd([]);



        // One card, inserted. NOT a recalculation of the week: re-planning
        // after every addition is what made adding one school shuffle the four
        // already on the board, because the optimiser starts from scratch and
        // any change to its inputs re-clusters the days. The week the user has
        // accepted stays as it is; "Recalculate" is there when they do want it
        // rebuilt.

        setLoading(true);

        let card: VisitInfo | null = null;

        try {

            card = await getManualVisit(schoolId, dayKey, rule.rule.start, rule.rule.end);

        } catch (e) {

            console.error(e);

        }

        setLoading(false);

        if (!card) return;



        // This school is placed now, so its own auto-proposal elsewhere in the
        // week goes — the same eviction the server would do on the next
        // recalculation. A completed visit or another hand-placed slot at the
        // same school stays: Horace Mann's two Music Production classes are two
        // visits, not one.

        const isSameSlot = (v: VisitInfo) =>

            v.schoolId === card!.schoolId && dayKeyOf(v.date) === dayKeyOf(card!.date) && v.startTime === card!.startTime;



        setPlannedVisits([

            ...plannedVisits.filter(v => !isSameSlot(v) && (v.schoolId !== card!.schoolId || v.isCompleted || v.isPinned)),

            card,

        ]);

    };



    useEffect(() => {

        let isMounted = true;

        const load = async () => {

            // A plan already computed for this exact question is kept, so
            // coming back to the tab leaves the week as the user left it and
            // their adjustments survive.
            //
            // The question is the whole key, not just the week: it used to be
            // "do we have any visit in this week?", which was true for a plan
            // built for a different region or a different target, so changing
            // the region picker or "Target visits" left the old plan sitting on
            // screen doing nothing. The only control that visibly did anything
            // was Recalculate — which is also the one that throws away every
            // manual change, so that became the habit.
            if (plannedFor === planKey && plannedVisits.length > 0) return;

            setLoading(true);

            const plan = await getWeeklyPlan(weekStartKey, manualOverrides, maxVisitsPerWeek, maxVisitsPerDay, regionFilter);

            if (isMounted) {

                setPlan(plan, planKey);

                setLoading(false);

            }

        };

        load();

        return () => { isMounted = false; };

        // planKey IS the dependency list: week, region and both caps, joined.
        // The rest of what this closure reads — the overrides, the setters — is
        // deliberately not a trigger. Refetching when an override changes is
        // exactly the behaviour being fixed here; each handler decides for
        // itself whether its edit needs the server.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planKey]);



    // Mon-Fri as Miami day keys — see weekDayKeys.
    const days = weekDayKeys;



    return (

        <div className="p-4 sm:p-6">

            {/* Said once, at the top, rather than leaving somebody to work out
                why the rows have no buttons. Naming the region matters: with
                "All Regions" picked this is every manager's week at once, which
                is not what "the plan" usually means. */}
            {!canPlan && (
                <p className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-gray-300">
                    You are viewing this plan, not driving it — confirming, postponing and
                    skipping stay with the Regional Manager whose week it is. Use the region
                    picker to choose whose plan you are looking at.
                </p>
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 space-y-4 sm:space-y-0">

                <div className="flex flex-wrap items-center gap-3">

                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Weekly Route Plan</h2>

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

                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">

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



                    {canPlan && (

                    <button

                        onClick={handleOpenAddModal}

                        disabled={loading}

                        className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shadow-sm"

                        title="Manually force an extra school into this week"

                    >

                        <span>+ Add</span>

                    </button>

                    )}

                    <button

                        onClick={() => {

                            // Asked, because this is the one control that throws
                            // work away: everything added, moved or deleted by
                            // hand this week goes. The caps and the region
                            // picker recalculate on their own now, so nobody has
                            // to come through here to get a fresh plan.
                            if (manualOverrides.length > 0 && !confirm("Recalculate from scratch? Everything you have added, moved or deleted by hand this week will be discarded.")) return;

                            clearOverrides();

                            // Explicitly empty. clearOverrides() cannot be seen
                            // by a closure that already exists, so reading them
                            // back here sent the very pins and skips this button
                            // is meant to discard.
                            fetchPlan([]);

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

                {days.map((formattedDate, idx) => {

                    const day = labelDateFor(formattedDate);

                    const toMins = (t?: string) => {
                        if (!t || t === "Done") return 999999;
                        const [h, m] = t.split(":").map(Number);
                        return (h ?? 0) * 60 + (m ?? 0);
                    };

                    const dayVisits = plannedVisits
                        .filter(v => dayKeyOf(v.date) === formattedDate)
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

                                                    <div className="flex items-center">
                                                        <Clock size={12} className="mr-1" />
                                                        {visit.classStartTime && visit.classEndTime
                                                            ? `${visit.classStartTime} - ${visit.classEndTime}`
                                                            : `${visit.startTime} - ${visit.endTime}`}
                                                    </div>

                                                    <div className="flex items-center"><MapPin size={12} className="mr-1" /> {visit.zipCode}</div>

                                                </div>

                                                {/* The full class period is the headline now; the 20-minute drop-in this
                                                    plan actually recommends goes underneath, in parentheses — only shown
                                                    when it's a slice of the class rather than the whole thing. */}
                                                {visit.classStartTime && visit.classEndTime &&
                                                    (visit.startTime !== visit.classStartTime || visit.endTime !== visit.classEndTime) && (
                                                    <div className="text-[11px] text-gray-400 dark:text-gray-500 -mt-1 mb-2">
                                                        (Recommended visit: {visit.startTime} - {visit.endTime}
                                                        {visit.startTime === visit.classStartTime
                                                            ? " · first 20 min"
                                                            : visit.endTime === visit.classEndTime
                                                                ? " · last 20 min"
                                                                : ""}
                                                        )
                                                    </div>
                                                )}



                                                <div className="flex justify-between items-start mt-3">

                                                    <div className="flex flex-col space-y-1.5 pt-1">

                                                        <p className="inline-block text-[11px] bg-gray-100 dark:bg-zinc-900/50 px-2.5 py-1 rounded text-gray-600 dark:text-gray-300 border border-dashed border-gray-300 dark:border-zinc-700 w-fit">

                                                            ⚡ {visit.reason}

                                                        </p>

                                                        {visit.notSeenInPerson && !visit.isCompleted && (

                                                            <p className="inline-flex items-center gap-1 text-[10px] leading-tight bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 rounded text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 w-fit font-medium">

                                                                <AlertCircle size={10} className="shrink-0" />

                                                                {visit.weeksSinceInPerson == null
                                                                    ? "Nobody has visited in person yet"
                                                                    : `No in-person visit in ${visit.weeksSinceInPerson} week${visit.weeksSinceInPerson === 1 ? "" : "s"}`}

                                                            </p>

                                                        )}

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



                                                    {canPlan && !visit.isCompleted && (

                                                        <div className="flex space-x-2">

                                                            <button

                                                                onClick={() => setConfirmModalData({
                                                                    schoolId: visit.schoolId,
                                                                    schoolName: visit.schoolName,
                                                                    visitDate: new Date(visit.date),
                                                                    lat: visit.lat,
                                                                    lng: visit.lng,
                                                                    subjectName: visit.subjectName,
                                                                    subjectId: visit.subjectId,
                                                                    teacherId: visit.teacherId,
                                                                    teacherName: visit.teacherName,
                                                                })}

                                                                disabled={loading}

                                                                title="Confirm Visit"

                                                                className="p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 rounded-lg transition-colors"

                                                            >

                                                                <CheckCircle size={16} />

                                                            </button>

                                                            <button

                                                                onClick={() => handleOpenPostpone(visit.schoolId, new Date(visit.date), visit.schoolName, visit.viableOptionsThisWeek || [])}

                                                                disabled={loading}

                                                                title="Postpone"

                                                                className="p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-amber-600 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 rounded-lg transition-colors"

                                                            >

                                                                <CalendarDays size={16} />

                                                            </button>

                                                            <button

                                                                onClick={() => handleSkip(visit.schoolId, new Date(visit.date))}

                                                                disabled={loading}

                                                                title="Delete"

                                                                className="p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/30 dark:hover:bg-red-900/50 rounded-lg transition-colors"

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
                    subjectId={confirmModalData.subjectId}
                    teacherId={confirmModalData.teacherId}
                    teacherName={confirmModalData.teacherName}
                    onClose={() => setConfirmModalData(null)}
                    onConfirmed={() => handleVisitConfirmed(confirmModalData.schoolId, confirmModalData.visitDate)}
                />

            )}

            {/* Postpone Modal */}

            {postponeModalData && (

                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">

                    <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-xl shadow-xl overflow-y-auto max-h-[90dvh] animate-in fade-in zoom-in duration-200">

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

                                    {days.filter(d => d >= todayKey && d !== dayKeyOf(postponeModalData.visitDate)).map((dateStr, idx) => {

                                        const day = labelDateFor(dateStr);
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

                                                            <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Choose session</p>

                                                        )}

                                                        {optionsForDay.map((opt, oIdx) => (

                                                            <button

                                                                key={`${dateStr}-${opt.rule.start}-${opt.rule.end}-${oIdx}`}

                                                                onClick={() => handlePostponeToDay(postponeModalData.schoolId, postponeModalData.visitDate, dateStr, opt.rule.start, opt.rule.end)}

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

                                    {days.filter(d => d >= todayKey && d !== dayKeyOf(postponeModalData.visitDate)).length === 0 && (

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

                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-sm">

                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-y-auto max-h-[90dvh] border border-gray-100 dark:border-zinc-800">

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
                                                return d >= todayKey;
                                            }).map((opt, i) => {

                                                const optDateStr = (opt.date && String(opt.date).slice(0, 10)) || opt.date;
                                                const optDate = labelDateFor(optDateStr);

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
                                                return d >= todayKey;
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

                                                {days.map((dayKey, i) => {

                                                    const day = labelDateFor(dayKey);

                                                    const isFuture = dayKey >= todayKey;

                                                    return (

                                                        <button

                                                            key={i}

                                                            disabled={!isFuture}

                                                            onClick={() => handleAddVisitConfirm({ date: dayKey, rule: { start: "09:00", end: "10:00" } })}

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

