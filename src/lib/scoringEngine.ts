import { PrismaClient } from "@prisma/client";
import { differenceInDays, startOfWeek, addDays, format } from "date-fns";
import { SchoolAvailabilityRule, DayType, VisitInfo, CalendarDayInfo } from "./types";

const prisma = new PrismaClient();

const getFrequencyDays = (target: string): number => {
    if (target === "weekly") return 7;
    if (target === "bi-weekly") return 14;
    if (target === "monthly") return 30;
    return 14;
};

const timeToMins = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

/**
 * Auxiliary function to generate plan for a specific week, given a set of known past visits.
 */
async function generatePlanForWeek(
    weekStartDate: Date,
    schools: any[],
    calendarDays: any[],
    manualOverrides: Partial<VisitInfo>[] = [],
    maxVisitsPerWeek: number = 5,
    simulatedPastVisits: Map<string, Date> // schoolId -> latest visit date
): Promise<VisitInfo[]> {
    const start = startOfWeek(weekStartDate, { weekStartsOn: 1 });
    const weekDates = Array.from({ length: 5 }).map((_, i) => addDays(start, i));

    const dayLookup = weekDates.map((date, idx) => {
        const found = calendarDays.find((c: any) => format(c.date, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'));
        return {
            date,
            dayType: (found?.dayType || (idx % 2 === 0 ? "A" : "B")) as DayType,
            description: found?.description
        };
    });

    const plannedVisits: VisitInfo[] = [];
    const scheduledSchoolIds = new Set<string>();

    for (const day of dayLookup) {
        if (day.dayType === "Planning" || day.dayType === "Holiday") {
            continue;
        }

        const availableCandidates: { school: any; rule: SchoolAvailabilityRule; score: number; reason: string }[] = [];
        const weekdayName = format(day.date, "EEEE");

        for (const school of schools) {
            if (scheduledSchoolIds.has(school.id)) continue;

            const pinnedDayThisWeek = dayLookup.find(d =>
                manualOverrides.some(o => o.schoolId === school.id && o.isPinned && o.date && format(new Date(o.date), 'yyyy-MM-dd') === format(d.date, 'yyyy-MM-dd'))
            );

            const isPinnedToday = manualOverrides.some(o =>
                o.schoolId === school.id && o.isPinned && o.date && format(new Date(o.date), 'yyyy-MM-dd') === format(day.date, 'yyyy-MM-dd')
            );

            if (pinnedDayThisWeek && !isPinnedToday) {
                // User pinned this school to a DIFFERENT day this week. Skip it today!
                continue;
            }

            let rules: SchoolAvailabilityRule[] = [];
            try { rules = JSON.parse(school.availability); } catch (e) { continue; }

            // Determine last visit date: either from simulated history or DB history
            const simVisit = simulatedPastVisits.get(school.id);
            const dbVisit = school.visitLogs[0] ? school.visitLogs[0].date : null;

            let lastVisit = dbVisit;
            if (simVisit && (!dbVisit || simVisit.getTime() > dbVisit.getTime())) {
                lastVisit = simVisit;
            }

            const daysSinceVisit = lastVisit ? differenceInDays(day.date, lastVisit) : 100;
            const freqLimit = getFrequencyDays(school.frequencyTarget);

            // Strict Filter: DO NOT SCHEDULE if it's not due soon (e.g. within 7 days of target)
            // Unless it's manually pinned.
            const override = manualOverrides.find(o =>
                o.schoolId === school.id &&
                o.date &&
                format(new Date(o.date), 'yyyy-MM-dd') === format(day.date, 'yyyy-MM-dd')
            );
            const isPinned = override?.isPinned || false;

            // Skip "Skipped" / "Deleted" overrides
            if (override?.isSkipped) {
                continue;
            }

            if (!isPinned && daysSinceVisit < freqLimit - 14) {
                continue; // Not due yet, skip this school for this week to avoid bunching up
            }

            const isOverdue = daysSinceVisit >= freqLimit;
            let score = isOverdue ? 100 + (daysSinceVisit - freqLimit) * 5 : daysSinceVisit;

            if (isPinned) {
                score = 1000;
            }

            let viableRules = rules.filter(r => (r.dayType === day.dayType) || (r.weekday === weekdayName));
            if (override && override.startTime) {
                const specificRule = viableRules.find(r => r.start === override.startTime && (!override.endTime || r.end === override.endTime));
                if (specificRule) {
                    viableRules = [specificRule];
                }
            }
            if (viableRules.length === 0) continue;

            let reason = "";
            if (isPinned) {
                reason = "Pinned manually";
            } else if (daysSinceVisit >= 90) {
                reason = "Action Required (Never Visited)";
            } else if (isOverdue) {
                reason = `Overdue by ${daysSinceVisit - freqLimit} days`;
            } else {
                reason = `Due in ${freqLimit - daysSinceVisit} days`;
            }

            availableCandidates.push({ school, rule: viableRules[0], score, reason });
        }

        availableCandidates.sort((a, b) => b.score - a.score);

        const maxVisitsPerDay = 4;
        const remainingForWeek = maxVisitsPerWeek - scheduledSchoolIds.size;
        const validPickCount = Math.min(maxVisitsPerDay, remainingForWeek);

        const selectedCandidates: typeof availableCandidates = [];

        for (const candidate of availableCandidates) {
            if (selectedCandidates.length >= validPickCount) break;

            const startMins = timeToMins(candidate.rule.start);
            const endMins = timeToMins(candidate.rule.end);

            const hasCriticalOverlap = selectedCandidates.some(selected => {
                const sStart = timeToMins(selected.rule.start);

                // Critical overlap: start times are within 15 minutes of each other
                if (Math.abs(startMins - sStart) < 15) return true;
                return false;
            });

            if (!hasCriticalOverlap) {
                selectedCandidates.push(candidate);
            }
        }

        selectedCandidates.sort((a, b) => timeToMins(a.rule.start) - timeToMins(b.rule.start));

        for (const pick of selectedCandidates) {
            plannedVisits.push({
                schoolId: pick.school.id,
                schoolName: pick.school.name,
                zipCode: pick.school.zipCode,
                date: day.date,
                score: pick.score,
                reason: pick.reason,
                startTime: pick.rule.start,
                endTime: pick.rule.end,
                isPinned: pick.score >= 1000,
                isCompleted: false,
                viableOptionsThisWeek: [] // Will populate after week is built
            });
            scheduledSchoolIds.add(pick.school.id);
            // Record in simulation map so next weeks see this as visited
            simulatedPastVisits.set(pick.school.id, day.date);
        }

        if (scheduledSchoolIds.size >= maxVisitsPerWeek) break;
    }

    return plannedVisits;
}

/**
 * Calculates the best visit schedule for a given week.
 * Simulates intermediate weeks to ensure future plans are realistic and dynamic.
 */
export async function generateWeeklyPlan(weekStartDate: Date, manualOverrides: Partial<VisitInfo>[] = [], maxVisitsPerWeek: number = 5): Promise<VisitInfo[]> {
    const targetWeekStart = startOfWeek(weekStartDate, { weekStartsOn: 1 });
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    // Fetch base data once
    const schools = await prisma.school.findMany({
        include: {
            visitLogs: { orderBy: { date: "desc" }, take: 1 }
        }
    });

    const simulatedPastVisits = new Map<string, Date>();

    // Fetch real completed VisitLogs strictly for the *target* week to mark them as done
    const targetDates = Array.from({ length: 5 }).map((_, i) => addDays(targetWeekStart, i));
    const visitLogsTargetWeek = await prisma.visitLog.findMany({
        where: { date: { in: targetDates } },
        include: { school: true }
    });

    // If the requested week is in the future, simulate the weeks leading up to it
    if (format(targetWeekStart, 'yyyy-MM-dd') > format(currentWeekStart, 'yyyy-MM-dd')) {
        const weeksToSimulate = differenceInDays(targetWeekStart, currentWeekStart) / 7;

        // Safety cap on simulation so it doesn't run infinitely if they click 10 years ahead
        const maxSimulations = Math.min(weeksToSimulate, 12);

        for (let i = 0; i < maxSimulations; i++) {
            const simWeekStart = addDays(currentWeekStart, i * 7);
            const simDates = Array.from({ length: 5 }).map((_, i) => addDays(simWeekStart, i));
            const calDays = await prisma.calendarDay.findMany({ where: { date: { in: simDates } } });

            // Generate (and implicitly update simulatedPastVisits map)
            await generatePlanForWeek(simWeekStart, schools, calDays, [], maxVisitsPerWeek, simulatedPastVisits);
        }
    }

    // Now generate for the actual requested target week
    const targetCalDays = await prisma.calendarDay.findMany({ where: { date: { in: targetDates } } });
    const finalPlan = await generatePlanForWeek(targetWeekStart, schools, targetCalDays, manualOverrides, maxVisitsPerWeek, simulatedPastVisits);

    // Merge in the actually completed VisitLogs for this week
    for (const log of visitLogsTargetWeek) {
        // If the generator picked it, replace it with the "Completed" true version
        const existingIdx = finalPlan.findIndex(p => p.schoolId === log.schoolId && format(p.date, 'yyyy-MM-dd') === format(log.date, 'yyyy-MM-dd'));
        const completedVisit: VisitInfo = {
            schoolId: log.schoolId,
            schoolName: log.school.name,
            zipCode: log.school.zipCode,
            date: log.date,
            score: 0,
            reason: log.notes || "Completed",
            startTime: "Done",
            endTime: "Done",
            isPinned: false,
            isCompleted: true
        };

        if (existingIdx >= 0) {
            finalPlan[existingIdx] = completedVisit;
        } else {
            finalPlan.push(completedVisit);
        }
    }

    // Synthesize the full week array to prevent empty arrays if DB is missing calendar dates
    const startTarget = startOfWeek(targetWeekStart, { weekStartsOn: 1 });
    const weekDatesTarget = Array.from({ length: 5 }).map((_, i) => addDays(startTarget, i));
    const synthesizedCalDays = weekDatesTarget.map((date, idx) => {
        const found = targetCalDays.find((c: any) => c.date.getTime() === date.getTime());
        return { date, dayType: (found?.dayType || (idx % 2 === 0 ? "A" : "B")) as DayType };
    });

    // Populate viableDaysThisWeek for the generated final plan using timezone-safe format
    for (const visit of finalPlan) {
        const school = schools.find(s => s.id === visit.schoolId);
        if (!school) continue;

        const rules = JSON.parse(school.availability) as SchoolAvailabilityRule[];
        const viableOptions: { date: string, rule: SchoolAvailabilityRule }[] = [];

        for (const day of synthesizedCalDays) {
            const weekdayName = format(day.date, "EEEE");
            const matchingRules = rules.filter(r => r.dayType === day.dayType || r.weekday === weekdayName);
            for (const rule of matchingRules) {
                viableOptions.push({
                    date: format(day.date, "yyyy-MM-dd"),
                    rule
                });
            }
        }

        visit.viableOptionsThisWeek = viableOptions;
    }

    // Ensure chronological order within the same day
    finalPlan.sort((a, b) => {
        if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
        if (a.isCompleted) return -1;
        if (b.isCompleted) return 1;
        return timeToMins(a.startTime || "00:00") - timeToMins(b.startTime || "00:00");
    });

    return finalPlan;
}
