import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format } from 'date-fns';
import { VisitInfo } from '../lib/types';

interface PlannerState {
    activeTab: 'dashboard' | 'planner' | 'profiles' | 'map' | 'history';
    setActiveTab: (tab: 'dashboard' | 'planner' | 'profiles' | 'map' | 'history') => void;

    weekStartDateStr: string;
    setWeekStartDate: (date: Date) => void;

    plannedVisits: VisitInfo[];
    setPlannedVisits: (visits: VisitInfo[]) => void;

    manualOverrides: Partial<VisitInfo>[];
    addOverride: (override: Partial<VisitInfo>) => void;
    clearOverrides: () => void;

    maxVisitsPerWeek: number;
    setMaxVisitsPerWeek: (max: number) => void;
}

export const usePlannerStore = create<PlannerState>()(
    persist(
        (set) => ({
            activeTab: 'dashboard',
            setActiveTab: (tab) => set({ activeTab: tab }),

            weekStartDateStr: new Date().toISOString(), // Use string for persistence
            setWeekStartDate: (date) => set({ weekStartDateStr: date.toISOString() }),

            plannedVisits: [],
            setPlannedVisits: (visits) => set({ plannedVisits: visits }),

            manualOverrides: [],
            addOverride: (override) => set((state) => {
                const existingIndex = state.manualOverrides.findIndex(
                    (o) => o.schoolId === override.schoolId && o.date && override.date && format(new Date(o.date), 'yyyy-MM-dd') === format(new Date(override.date), 'yyyy-MM-dd')
                );
                if (existingIndex >= 0) {
                    const newOverrides = [...state.manualOverrides];
                    newOverrides[existingIndex] = { ...newOverrides[existingIndex], ...override };
                    return { manualOverrides: newOverrides };
                }
                return { manualOverrides: [...state.manualOverrides, override] };
            }),
            clearOverrides: () => set({ manualOverrides: [] }),

            maxVisitsPerWeek: 5,
            setMaxVisitsPerWeek: (max) => set({ maxVisitsPerWeek: max }),
        }),
        {
            name: 'planner-storage',
            partialize: (state) => ({
                manualOverrides: state.manualOverrides,
                plannedVisits: state.plannedVisits,
                weekStartDateStr: state.weekStartDateStr,
                maxVisitsPerWeek: state.maxVisitsPerWeek
            }),
        }
    )
);
