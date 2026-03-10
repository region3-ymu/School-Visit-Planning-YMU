import { DayType, CalendarDayInfo } from "./types";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Ensures calendar data is parsed and available. 
 * For MVP, this allows feeding JSON or array to seed the CalendarDays.
 */
export async function seedCalendar(days: { date: Date; dayType: DayType; description?: string }[]) {
    for (const day of days) {
        await prisma.calendarDay.upsert({
            where: { date: day.date },
            update: { dayType: day.dayType, description: day.description },
            create: { date: day.date, dayType: day.dayType, description: day.description },
        });
    }
}

/**
 * Retrieves the day type from the database for a specific date.
 */
export async function getCalendarDay(date: Date): Promise<CalendarDayInfo | null> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dayRec = await prisma.calendarDay.findFirst({
        where: {
            date: {
                gte: startOfDay,
                lt: endOfDay,
            },
        },
    });

    if (!dayRec) return null;

    return {
        id: dayRec.id,
        date: dayRec.date,
        dayType: dayRec.dayType as DayType,
        description: dayRec.description || undefined,
    };
}
