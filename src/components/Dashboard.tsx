"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { getDashboardStats, syncExportSheet, refreshClasses } from "@/app/actions";
import { usePlannerStore } from "@/store/plannerStore";
import { OVERSIGHT_ROLES } from "@/lib/permissions";
import SchoolHoldPanel from "@/components/school/SchoolHoldPanel";
import {
    Building2,
    CalendarX,
    ChevronDown,
    ClipboardList,
    ClockAlert,
    ExternalLink,
    Footprints,
    MapPinOff,
    Phone,
    Plus,
    RefreshCw,
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
    onClick,
    expanded,
}: {
    label: string;
    value: number;
    hint?: string;
    icon: React.ReactNode;
    tone: keyof typeof TONES;
    /** Set when the card opens the list of schools behind its number. */
    onClick?: () => void;
    expanded?: boolean;
}) {
    const body = (
        <>
            <div className={`p-3 rounded-lg shrink-0 ${TONES[tone]}`}>{icon}</div>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
                <p className="text-2xl sm:text-3xl font-semibold text-gray-800 dark:text-gray-100">{value}</p>
                {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
            </div>
        </>
    );
    const frame =
        "bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-xl shadow-sm border flex items-center gap-4 w-full text-left";
    if (!onClick) {
        return <div className={`${frame} border-gray-100 dark:border-zinc-800`}>{body}</div>;
    }
    return (
        <button
            type="button"
            onClick={onClick}
            aria-expanded={expanded}
            className={`${frame} transition-colors ${
                expanded
                    ? "border-indigo-400 dark:border-indigo-500"
                    : "border-gray-100 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-600"
            }`}
        >
            {body}
            {value > 0 && (
                <ChevronDown
                    size={18}
                    className={`shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
            )}
        </button>
    );
}

/** Noon, so date-fns names the Miami day without a midnight instant tipping over. */
const dayLabel = (dayKey: string) => format(new Date(`${dayKey}T12:00:00`), "EEE, MMM d");

type SchoolListKey = "due" | "overdue" | "never";

/**
 * Refresh the export spreadsheet on demand.
 *
 * Shown to oversight because the sheet is theirs to read; an RM has the app
 * itself and never needs to repaint eleven tabs. The cron still runs nightly —
 * this exists for the afternoon when somebody wants today's visits in a pivot
 * and the alternative is waiting until tomorrow.
 */
function ExportSyncCard() {
    const [state, setState] = useState<
        { status: "idle" | "running" } | { status: "done"; at: string; url: string } | { status: "error"; message: string }
    >({ status: "idle" });

    const run = async () => {
        setState({ status: "running" });
        try {
            const r = await syncExportSheet();
            setState({
                status: "done",
                // The server's clock is the honest one here: it is what actually
                // wrote the sheet, and it is what the Sync info tab will say.
                at: new Date(r.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                url: r.url,
            });
        } catch (e) {
            setState({ status: "error", message: e instanceof Error ? e.message : "Sync failed" });
        }
    };

    return (
        <div className="mt-8 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl shadow-sm p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Data export</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        The spreadsheet refreshes itself every evening. Refresh it now to pull in
                        today&apos;s visits.
                    </p>
                </div>
                <button
                    onClick={run}
                    disabled={state.status === "running"}
                    className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                >
                    <RefreshCw size={16} className={state.status === "running" ? "animate-spin" : ""} />
                    {state.status === "running" ? "Refreshing…" : "Refresh now"}
                </button>
            </div>
            {state.status === "done" && (
                <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    Refreshed at {state.at}.
                    <a href={state.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                        Open the spreadsheet <ExternalLink size={13} />
                    </a>
                </p>
            )}
            {state.status === "error" && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.message}</p>
            )}
        </div>
    );
}

export default function Dashboard({
    regionFilter,
    canLogVisit = false,
}: {
    regionFilter?: string | null;
    canLogVisit?: boolean;
}) {
    const requestLogVisit = usePlannerStore((s) => s.requestLogVisit);
    const [stats, setStats] = useState({
        totalActiveSchools: 0,
        dueThisWeek: 0,
        overdue: 0,
        neverVisited: 0,
        overdueSchools: [] as { id: string; name: string; lastVisitKey: string; daysLate: number }[],
        dueSchools: [] as { id: string; name: string; dueKey: string }[],
        neverVisitedSchools: [] as { id: string; name: string }[],
        recentCancellations: 0,
        cancellationWindowDays: 30,
        thisWeek: { inPerson: 0, online: 0, phone: 0, total: 0 },
        visitedSchoolsList: [] as { id: string, name: string, visitCount: number, classes: { name: string; count: number }[] }[],
        classesBySchool: {} as Record<string, string[]>,
        onHoldSchools: [] as { id: string; name: string; reason: string | null; sinceKey: string | null; hasClassesAgain: boolean; canChange: boolean }[],
        holdSuggestions: [] as { id: string; name: string; canChange: boolean }[],
        holdSuggestionWeeks: { back: 3, ahead: 4 },
    });

    useEffect(() => {
        getDashboardStats(regionFilter).then(setStats);
    }, [regionFilter]);

    // #53: keep classes fresh from YMU-A — throttled server-side to once every
    // 5 minutes across everyone, so opening the dashboard costs nothing extra.
    // Stats are recounted only if something actually changed.
    useEffect(() => {
        void refreshClasses(false).then((res) => {
            if (res.ok && !res.result.skipped && res.result.created + res.result.updated + res.result.removed > 0) {
                getDashboardStats(regionFilter).then(setStats);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // FR-038 (Carlos Fabre): the cadence cards open the schools behind them.
    const [openList, setOpenList] = useState<SchoolListKey | null>(null);
    const toggleList = (key: SchoolListKey) => setOpenList((cur) => (cur === key ? null : key));

    const listRows: { id: string; name: string; detail: string | null }[] =
        openList === "overdue"
            ? stats.overdueSchools.map((s) => ({
                  id: s.id,
                  name: s.name,
                  detail: `${s.daysLate === 0 ? "Due today" : `${s.daysLate} day${s.daysLate === 1 ? "" : "s"} late`} · last in person ${dayLabel(s.lastVisitKey)}`,
              }))
            : openList === "due"
              ? stats.dueSchools.map((s) => ({ id: s.id, name: s.name, detail: `Due ${dayLabel(s.dueKey)}` }))
              : openList === "never"
                ? stats.neverVisitedSchools.map((s) => ({ id: s.id, name: s.name, detail: null }))
                : [];
    const listTitle =
        openList === "overdue" ? "Overdue schools" : openList === "due" ? "Due this week" : "Never visited";

    const { data: session } = useSession();
    const role = session?.user?.role;
    // The server checks this too — syncExportSheet() refuses any other role.
    // Hiding it is about not offering a button that would fail.
    const isOversight = Boolean(
        (role && OVERSIGHT_ROLES.includes(role)) || session?.user?.isAppAdmin
    );

    return (
        <div className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">Overview Dashboard</h2>
                {/* FR-029 (Eric Levy): logging a visit or a call used to mean
                    Visit History first, then its button. Same form, one tap. */}
                {canLogVisit && (
                    <button
                        type="button"
                        onClick={requestLogVisit}
                        className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
                    >
                        <Plus size={18} />
                        Log a visit
                    </button>
                )}
            </div>

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
                    onClick={() => toggleList("due")}
                    expanded={openList === "due"}
                />
                <StatCard
                    label="Overdue"
                    value={stats.overdue}
                    hint="Past its interval"
                    icon={<ClockAlert size={24} />}
                    tone="red"
                    onClick={() => toggleList("overdue")}
                    expanded={openList === "overdue"}
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
                    onClick={() => toggleList("never")}
                    expanded={openList === "never"}
                />
            </div>

            {openList && (
                <div className="mt-4 bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 p-4 sm:p-6">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                        {listTitle} ({listRows.length})
                    </h3>
                    {listRows.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">None right now.</p>
                    ) : (
                        <ul className="mt-3 divide-y divide-gray-100 dark:divide-zinc-800">
                            {listRows.map((row) => (
                                <li key={row.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100 min-w-0">
                                        {row.name}
                                        {(stats.classesBySchool[row.id] ?? []).length > 0 && (
                                            <span className="font-normal text-gray-500 dark:text-gray-400"> · {stats.classesBySchool[row.id].join(", ")}</span>
                                        )}
                                    </span>
                                    {row.detail && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{row.detail}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <SchoolHoldPanel
                onHold={stats.onHoldSchools}
                suggestions={stats.holdSuggestions}
                weeks={stats.holdSuggestionWeeks}
                onChanged={() => getDashboardStats(regionFilter).then(setStats)}
            />

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
                        Schools Visited
                    </h3>
                </div>
                <div className="p-0">
                    {stats.visitedSchoolsList.length === 0 ? (
                        <div className="p-8 text-center text-sm text-gray-500">
                            No visits recorded yet.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
                            {stats.visitedSchoolsList.map((school) => (
                                <li key={school.id} className="p-4 flex justify-between items-center gap-3 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                                    <span className="min-w-0">
                                        <span className="block font-medium text-gray-800 dark:text-gray-200">{school.name}</span>
                                        {/* By class: what those visits actually observed. */}
                                        {school.classes.length > 0 && (
                                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                                                {school.classes.map((c) => `${c.name} ×${c.count}`).join(" · ")}
                                            </span>
                                        )}
                                    </span>
                                    <span className="shrink-0 text-sm px-3 py-1 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold rounded-full">
                                        {school.visitCount} visit{school.visitCount !== 1 ? "s" : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {isOversight && <ExportSyncCard />}
        </div>
    );
}
