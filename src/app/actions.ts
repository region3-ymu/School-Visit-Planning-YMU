"use server";

import { PrismaClient } from "@prisma/client";
import { generateWeeklyPlan } from "@/lib/scoringEngine";
import { VisitInfo } from "@/lib/types";
import { format, addDays, startOfWeek } from "date-fns";

const prisma = new PrismaClient();

export async function getDashboardStats() {
    const totalSchools = await prisma.school.count();

    const visitCounts = await prisma.visitLog.groupBy({
        by: ['schoolId'],
        _count: {
            id: true,
        },
    });

    const schools = await prisma.school.findMany({
        select: { id: true, name: true }
    });

    const visitedSchoolsList = schools.map(school => {
        const vc = visitCounts.find(v => v.schoolId === school.id);
        return {
            id: school.id,
            name: school.name,
            visitCount: vc ? vc._count.id : 0
        };
    }).sort((a, b) => b.visitCount - a.visitCount);

    return {
        totalActiveSchools: totalSchools,
        // Since we are calculating "dueThiseWeek" dynamically via scoring engine, keep these as placeholders or compute fully.
        dueThisWeek: Math.floor(totalSchools / 3),
        overdue: 0,
        recentCancellations: 0,
        visitedSchoolsList
    };
}

export async function getSchools() {
    return await prisma.school.findMany({
        orderBy: { name: "asc" },
    });
}

export async function getWeeklyPlan(weekStartDateIso: string, manualOverrides: Partial<VisitInfo>[] = [], maxVisitsPerWeek: number = 5) {
    const date = new Date(weekStartDateIso);
    return await generateWeeklyPlan(date, manualOverrides, maxVisitsPerWeek);
}

export async function getSchoolOptionsForWeek(schoolId: string, weekStartDateIso: string): Promise<import('@/lib/types').ViableOption[]> {
    const date = new Date(weekStartDateIso);
    const start = startOfWeek(date, { weekStartsOn: 1 });
    const weekDates = Array.from({ length: 5 }).map((_, i) => addDays(start, i));

    const calDays = await prisma.calendarDay.findMany({ where: { date: { in: weekDates } } });
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return [];

    let rules: any[] = [];
    try { rules = JSON.parse(school.availability); } catch (e) { return []; }

    const options: import('@/lib/types').ViableOption[] = [];

    weekDates.forEach((d, idx) => {
        const cal = calDays.find(c => c.date.getTime() === d.getTime());
        const dayType = cal?.dayType || (idx % 2 === 0 ? "A" : "B");
        if (dayType === "Planning" || dayType === "Holiday") return;

        rules.forEach(r => {
            let matches = false;
            if (r.weekday) matches = format(d, "EEEE") === r.weekday;
            else if (r.dayType) matches = dayType === r.dayType;
            else matches = true;

            if (matches) {
                options.push({ date: format(d, 'yyyy-MM-dd'), rule: r });
            }
        });
    });

    return options;
}

export async function seedSchoolsMock() {
    const existingCount = await prisma.school.count();
    if (existingCount > 0) {
        return { success: true, count: existingCount, skipped: true };
    }

    // Keep strict dates using specific UTC strings for consistency
    const tz = "T12:00:00Z";

    const schoolsData = [
        {
            name: "Young Men’s Preparatory Academy",
            zipCode: "33127",
            address: "3001 NW 2nd Ave, Miami, FL 33127",
            lat: 25.8049,
            lng: -80.1991,
            frequencyTarget: "weekly",
            visits: ["2026-02-26" + tz],
            rules: [
                { weekday: "Monday", start: "12:40", end: "14:10", class: "Modern Band and Drumline" },
                { weekday: "Thursday", start: "12:40", end: "14:10", class: "Modern Band and Drumline" },
                { weekday: "Wednesday", start: "10:55", end: "12:35", class: "Modern Band and Drumline" }
            ]
        },
        {
            name: "West Little River K-8",
            zipCode: "33147",
            address: "2450 NW 84th St, Miami, FL 33147",
            lat: 25.8504,
            lng: -80.2386,
            frequencyTarget: "bi-weekly",
            visits: ["2026-03-04" + tz, "2026-03-06" + tz],
            rules: [
                { dayType: "A", start: "13:40", end: "15:05", class: "Beggining Band" },
                { dayType: "B", start: "13:40", end: "15:05", class: "Drumline" },
                { weekday: "Wednesday", start: "12:42", end: "13:50", class: "Band/Drumline" }
            ]
        },
        {
            name: "Coral Gables Senior High School",
            zipCode: "33146",
            address: "450 Bird Rd, Coral Gables, FL 33146",
            lat: 25.7336,
            lng: -80.2635,
            frequencyTarget: "bi-weekly",
            visits: ["2026-02-25" + tz],
            rules: [
                { dayType: "A", start: "09:00", end: "10:30", class: "Guitar 1" }
            ]
        },
        {
            name: "Horace Mann Middle School",
            zipCode: "33150",
            address: "8950 NW 2nd Ave, El Portal, FL 33150",
            lat: 25.8568,
            lng: -80.1983,
            frequencyTarget: "monthly",
            visits: ["2026-02-24" + tz, "2026-03-06" + tz],
            rules: [
                { dayType: "B", start: "10:45", end: "12:10", class: "Beginning Band" },
                { dayType: "B", start: "14:25", end: "15:50", class: "Music Production" }
            ]
        },
        {
            name: "Miami Edison Senior High School",
            zipCode: "33127",
            address: "6161 NW 5th Ct, Miami, FL 33127",
            lat: 25.8320,
            lng: -80.2018,
            frequencyTarget: "monthly",
            visits: ["2026-02-25" + tz, "2026-03-05" + tz],
            rules: [
                { dayType: "A", start: "10:30", end: "12:00", class: "Music Production" }
            ]
        },
        {
            name: "Brownsville Middle School",
            zipCode: "33142",
            address: "4899 NW 24th Ave, Miami, FL 33142",
            lat: 25.8174,
            lng: -80.2335,
            frequencyTarget: "weekly",
            visits: ["2026-03-05" + tz],
            rules: [
                { dayType: "A", start: "09:25", end: "10:50", class: "Drumline" },
                { dayType: "B", start: "09:25", end: "10:50", class: "Drumline" }
            ]
        },
        {
            name: "Edison Park K-8",
            zipCode: "33127",
            address: "500 NW 67th St, Miami, FL 33127",
            lat: 25.8368,
            lng: -80.2081,
            frequencyTarget: "weekly",
            visits: ["2026-02-26" + tz, "2026-03-04" + tz],
            rules: [
                { dayType: "B", start: "11:40", end: "13:35", class: "Modern Band" },
                { dayType: "B", start: "13:40", end: "15:05", class: "Drum Line" },
                { weekday: "Wednesday", start: "11:05", end: "12:40", class: "Modern Band" },
                { weekday: "Wednesday", start: "12:45", end: "13:50", class: "Drum Line" }
            ]
        },
        {
            name: "Georgia Jones-Ayers Middle School",
            zipCode: "33142",
            address: "1331 NW 46th St, Miami, FL 33142",
            lat: 25.8143,
            lng: -80.2185,
            frequencyTarget: "bi-weekly",
            visits: [],
            rules: [
                { dayType: "B", start: "09:20", end: "10:45", class: "Begining Band" },
                { dayType: "A", start: "12:55", end: "14:20", class: "Drumline" }
            ]
        },
        {
            name: "Kelsey L Pharr Elementary School",
            zipCode: "33142",
            address: "2000 NW 46th St, Miami, FL 33142",
            lat: 25.8145,
            lng: -80.2291,
            frequencyTarget: "monthly",
            visits: [],
            rules: [
                { weekday: "Monday", start: "14:05", end: "15:05", class: "Pitch & Rhythm" },
                { weekday: "Friday", start: "14:05", end: "15:05", class: "Pitch & Rhythm" }
            ]
        },
        {
            name: "Citrus Grove K-8",
            zipCode: "33125",
            address: "2121 NW 5th St, Miami, FL 33125",
            lat: 25.7761,
            lng: -80.2037,
            frequencyTarget: "weekly",
            visits: [],
            rules: [
                { dayType: "A", start: "12:20", end: "13:40", class: "Begining Band" },
                { dayType: "B", start: "12:20", end: "13:40", class: "Begining Band" },
                { weekday: "Wednesday", start: "11:45", end: "12:45", class: "Begining Band" }
            ]
        },
        {
            name: "MorningSide K-8",
            zipCode: "33138",
            address: "6620 NE 5th Ave, Miami, FL 33138",
            lat: 25.8360,
            lng: -80.1856,
            frequencyTarget: "bi-weekly",
            visits: ["2026-02-24" + tz, "2026-03-05" + tz],
            rules: [
                { dayType: "A", start: "13:15", end: "15:05", class: "Music Production" },
                { weekday: "Wednesday", start: "11:47", end: "12:35", class: "Music Production" },
                { dayType: "B", start: "13:15", end: "15:05", class: "Music Production" },
                { weekday: "Wednesday", start: "13:05", end: "13:50", class: "Music Production" }
            ]
        }
    ];

    for (const s of schoolsData) {
        const school = await prisma.school.create({
            data: {
                name: s.name,
                zipCode: s.zipCode,
                lat: s.lat,
                lng: s.lng,
                frequencyTarget: s.frequencyTarget,
                availability: JSON.stringify(s.rules),
            }
        });

        // Insert provided manual visit logs
        for (const visitIso of s.visits) {
            await prisma.visitLog.create({
                data: {
                    schoolId: school.id,
                    date: new Date(visitIso),
                    notes: "Historical Visit Pre-seeded"
                }
            });
        }
    }

    return { success: true, count: schoolsData.length };
}

export async function updateSchoolSettings(id: string, data: { frequencyTarget: string, availability: string }) {
    JSON.parse(data.availability); // Validate JSON format
    return await prisma.school.update({
        where: { id },
        data: {
            frequencyTarget: data.frequencyTarget,
            availability: data.availability
        }
    });
}

export async function confirmVisit(schoolId: string, dateIso: string, notes: string = "Completed via Planner") {
    const date = new Date(dateIso);
    return await prisma.visitLog.create({
        data: {
            schoolId,
            date,
            notes
        }
    });
}

export async function getVisitHistory() {
    return await prisma.visitLog.findMany({
        include: {
            school: true
        },
        orderBy: { date: 'desc' }
    });
}

export async function addManualVisit(schoolId: string, dateIso: string, notes: string) {
    const date = new Date(dateIso);
    return await prisma.visitLog.create({
        data: {
            schoolId,
            date,
            notes
        }
    });
}

export async function deleteVisitLog(id: string) {
    return await prisma.visitLog.delete({
        where: { id }
    });
}

export async function editVisitLog(id: string, newDateIso: string, newNotes: string) {
    return await prisma.visitLog.update({
        where: { id },
        data: {
            date: new Date(newDateIso),
            notes: newNotes
        }
    });
}
