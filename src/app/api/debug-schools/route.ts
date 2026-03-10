import { NextRequest, NextResponse } from 'next/server';
import { format, addDays, startOfWeek, differenceInDays } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    const schools = await prisma.school.findMany({
      include: {
        visitLogs: { orderBy: { date: "desc" }, take: 1 }
      }
    });

    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekDates = Array.from({ length: 5 }).map((_, i) => addDays(weekStart, i));

    const debugInfo = {
      weekStart: format(weekStart, 'yyyy-MM-dd'),
      weekDates: weekDates.map(d => format(d, 'yyyy-MM-dd')),
      schools: schools.map(school => {
        const lastVisit = school.visitLogs[0] ? school.visitLogs[0].date : null;
        const daysSinceVisit = lastVisit ? differenceInDays(new Date(), new Date(lastVisit)) : 100;
        
        // Parse availability rules
        let availabilityRules = [];
        try {
          availabilityRules = JSON.parse(school.availability);
        } catch (e) {
          availabilityRules = [];
        }

        // Check availability for each day this week
        const dailyAvailability = weekDates.map(date => {
          const weekdayName = format(date, 'EEEE');
          const dayType = date.getDay() % 2 === 0 ? "A" : "B";
          
          const availableRules = availabilityRules.filter((r: any) => 
            r.dayType === dayType || r.weekday === weekdayName
          );

          return {
            date: format(date, 'yyyy-MM-dd'),
            weekday: weekdayName,
            dayType: dayType,
            availableSlots: availableRules.length,
            rules: availableRules
          };
        });

        return {
          id: school.id,
          name: school.name,
          frequencyTarget: school.frequencyTarget,
          lastVisit: lastVisit ? format(new Date(lastVisit), 'yyyy-MM-dd') : 'Never',
          daysSinceVisit,
          availabilityRules: availabilityRules,
          dailyAvailability,
          totalAvailableSlotsThisWeek: dailyAvailability.reduce((sum, day) => sum + day.availableSlots, 0)
        };
      })
    };

    await prisma.$disconnect();

    return NextResponse.json(debugInfo);
    
  } catch (error) {
    console.error('Debug schools error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
