import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { subDays } from 'date-fns';
// Miami, not the browser's zone — the same day keys the server plans with, so a
// skip clicked here lands on the day the server files it under.
import { dayKeyInAppZone } from '../lib/timezone';
import { dayScopeOf } from '../lib/plannerOverrides';
import { VisitInfo } from '../lib/types';

type PlannerTab = 'dashboard' | 'planner' | 'profiles' | 'map' | 'history' | 'reports';

interface PlannerState {
    activeTab: PlannerTab;
    setActiveTab: (tab: PlannerTab) => void;

    weekStartDateStr: string;
    setWeekStartDate: (date: Date) => void;

    plannedVisits: VisitInfo[];
    setPlannedVisits: (visits: VisitInfo[]) => void;

    /**
     * What the cached plannedVisits were computed for: week, region and both
     * caps, as one key. The planner keeps its plan rather than recalculating
     * every time the tab is opened, so it needs to know when the cached plan is
     * for a different question than the one now on screen — changing "Target
     * visits" or the region used to leave the old plan on screen untouched, and
     * the only thing that would move it was "Recalculate", which throws away
     * every manual change.
     */
    plannedFor: string | null;
    setPlan: (visits: VisitInfo[], plannedFor: string) => void;

    manualOverrides: Partial<VisitInfo>[];
    addOverride: (override: Partial<VisitInfo>) => void;
    clearOverrides: () => void;

    maxVisitsPerWeek: number;
    setMaxVisitsPerWeek: (max: number) => void;

    maxVisitsPerDay: number;
    setMaxVisitsPerDay: (max: number) => void;
}

const OVERRIDE_RETENTION_DAYS = 14;

export const usePlannerStore = create<PlannerState>()(
    persist(
        (set) => ({
            activeTab: 'dashboard',
            setActiveTab: (tab) => set({ activeTab: tab }),

            weekStartDateStr: new Date().toISOString(),
            setWeekStartDate: (date) => set({ weekStartDateStr: date.toISOString() }),

            plannedVisits: [],
            setPlannedVisits: (visits) => set({ plannedVisits: visits }),

            plannedFor: null,
            setPlan: (visits, plannedFor) => set({ plannedVisits: visits, plannedFor }),

            manualOverrides: [],
            addOverride: (override) => set((state) => {
                const sameDay = (a?: Date | string, b?: Date | string) =>
                    !!a && !!b && dayKeyInAppZone(new Date(a)) === dayKeyInAppZone(new Date(b));

                // A skip and a pin for the same school on the same day are
                // contradictory, not cumulative: deleting a hand-added visit,
                // or postponing one off its day, records a skip on top of the
                // pin that put it there. Keeping both is what brought the
                // deleted visit straight back on the next recalculation — the
                // server saw a live pin and put the row back.
                //
                // The server resolves the same contradiction the same way, in
                // resolveOverrides(), because it has to cope with lists written
                // before this rule existed. Dropping the loser here as well is
                // what stops the list growing a contradiction per edit — and
                // keeps what the screen believes and what the server believes
                // the same thing.
                const scope = override.schoolId && override.date
                    ? dayScopeOf(override.schoolId, override.date)
                    : null;
                const isOn = (o: Partial<VisitInfo>) =>
                    !!scope && !!o.schoolId && !!o.date && dayScopeOf(o.schoolId, o.date) === scope;

                let overrides = state.manualOverrides;
                if (override.isSkipped) {
                    overrides = overrides.filter((o) => !(o.isPinned && isOn(o)));
                } else if (override.isPinned) {
                    overrides = overrides.filter((o) => !(o.isSkipped && isOn(o)));
                }

                // Same school + same day is NOT the same override when it's a pin:
                // Horace Mann teaches Music Production twice on a B day, and pinning
                // the second slot must not overwrite the first — matched on start
                // time too, so only re-pinning the identical slot updates it in
                // place. A skip carries no startTime, so skips still dedupe against
                // each other by school + day alone, which is what "skip this school
                // that day" means regardless of which class.
                const existingIndex = overrides.findIndex(
                    (o) =>
                        o.schoolId === override.schoolId &&
                        sameDay(o.date, override.date) &&
                        o.startTime === override.startTime
                );
                if (existingIndex >= 0) {
                    const newOverrides = [...overrides];
                    newOverrides[existingIndex] = { ...newOverrides[existingIndex], ...override };
                    return { manualOverrides: newOverrides };
                }
                return { manualOverrides: [...overrides, override] };
            }),
            clearOverrides: () => set({ manualOverrides: [] }),

            maxVisitsPerWeek: 5,
            setMaxVisitsPerWeek: (max) => set({ maxVisitsPerWeek: max }),

            maxVisitsPerDay: 4,
            setMaxVisitsPerDay: (max) => set({ maxVisitsPerDay: max }),
        }),
        {
            name: 'planner-storage',
            partialize: (state) => ({
                manualOverrides: state.manualOverrides,
                plannedVisits: state.plannedVisits,
                plannedFor: state.plannedFor,
                weekStartDateStr: state.weekStartDateStr,
                maxVisitsPerWeek: state.maxVisitsPerWeek,
                maxVisitsPerDay: state.maxVisitsPerDay,
            }),
            // Drop overrides older than 14 days on hydration (AUDIT #7)
            merge: (persisted: unknown, current) => {
                const p = persisted as Partial<PlannerState>;
                const cutoff = subDays(new Date(), OVERRIDE_RETENTION_DAYS);
                const freshOverrides = (p.manualOverrides ?? []).filter((o) => {
                    if (!o.date) return false;
                    return new Date(o.date) >= cutoff;
                });
                return { ...current, ...p, manualOverrides: freshOverrides };
            },
        }
    )
);
