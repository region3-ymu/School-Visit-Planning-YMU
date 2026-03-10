import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyPlan } from '@/lib/scoringEngine';
import { format, addDays, startOfWeek, differenceInDays } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const weekStartDate = startOfWeek(new Date(), { weekStartsOn: 1 });
    
    // Get detailed school information
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    const schools = await prisma.school.findMany({
      include: {
        visitLogs: { orderBy: { date: "desc" }, take: 1 }
      }
    });

    const debugInfo = {
      weekStart: format(weekStartDate, 'yyyy-MM-dd'),
      totalSchools: schools.length,
      schools: schools.map(school => {
        const lastVisit = school.visitLogs[0] ? school.visitLogs[0].date : null;
        const daysSinceVisit = lastVisit ? differenceInDays(new Date(), new Date(lastVisit)) : 100;
        const freqLimit = school.frequencyTarget === 'weekly' ? 7 : school.frequencyTarget === 'bi-weekly' ? 14 : 30;
        
        // Apply the NEW filtering logic
        let isEligible = true;
        let eligibilityReason = "Eligible";
        
        if (school.frequencyTarget === "weekly") {
          if (daysSinceVisit < 0) {
            isEligible = false;
            eligibilityReason = "Weekly school visited in future";
          }
        } else if (school.frequencyTarget === "bi-weekly") {
          if (daysSinceVisit < 7) {
            isEligible = false;
            eligibilityReason = `Bi-weekly school visited only ${daysSinceVisit} days ago (need 7+)`;
          }
        } else if (school.frequencyTarget === "monthly") {
          if (daysSinceVisit < 21) {
            isEligible = false;
            eligibilityReason = `Monthly school visited only ${daysSinceVisit} days ago (need 21+)`;
          }
        }
        
        return {
          id: school.id,
          name: school.name,
          frequencyTarget: school.frequencyTarget,
          lastVisit: lastVisit ? format(new Date(lastVisit), 'yyyy-MM-dd') : 'Never',
          daysSinceVisit,
          freqLimit,
          isEligible,
          eligibilityReason,
          availability: school.availability
        };
      }),
      eligibilitySummary: {
        totalSchools: schools.length,
        eligibleSchools: schools.filter(s => {
          const lastVisit = s.visitLogs[0] ? s.visitLogs[0].date : null;
          const daysSinceVisit = lastVisit ? differenceInDays(new Date(), new Date(lastVisit)) : 100;
          
          if (s.frequencyTarget === "weekly") {
            return daysSinceVisit >= 0;
          } else if (s.frequencyTarget === "bi-weekly") {
            return daysSinceVisit >= 7;
          } else if (s.frequencyTarget === "monthly") {
            return daysSinceVisit >= 21;
          }
          return false;
        }).length
      }
    };

    await prisma.$disconnect();

    return NextResponse.json(debugInfo);
    
  } catch (error) {
    console.error('Debug detailed error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
