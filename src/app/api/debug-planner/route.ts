import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyPlan } from '@/lib/scoringEngine';
import { format, addDays, startOfWeek } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const weekStartDate = startOfWeek(new Date(), { weekStartsOn: 1 });
    const plan = await generateWeeklyPlan(weekStartDate, [], 11);
    
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
      plannedVisits: plan.length,
      schools: schools.map(school => {
        const lastVisit = school.visitLogs[0] ? school.visitLogs[0].date : null;
        const daysSinceVisit = lastVisit ? Math.floor((new Date().getTime() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)) : 100;
        const freqLimit = school.frequencyTarget === 'weekly' ? 7 : school.frequencyTarget === 'bi-weekly' ? 14 : 30;
        const isEligible = daysSinceVisit >= freqLimit - 14;
        
        return {
          name: school.name,
          frequencyTarget: school.frequencyTarget,
          lastVisit: lastVisit ? format(new Date(lastVisit), 'yyyy-MM-dd') : 'Never',
          daysSinceVisit,
          freqLimit,
          eligibleThisWeek: isEligible,
          reason: isEligible ? 
            (daysSinceVisit >= 90 ? "Never Visited" : 
             daysSinceVisit >= freqLimit ? `Overdue by ${daysSinceVisit - freqLimit} days` : 
             `Due in ${freqLimit - daysSinceVisit} days`) :
            `Not eligible (only ${daysSinceVisit} days since last visit, need ${freqLimit - 14}+)`
        };
      }),
      planDetails: plan.map(visit => ({
        school: visit.schoolName,
        date: format(new Date(visit.date), 'yyyy-MM-dd'),
        reason: visit.reason,
        startTime: visit.startTime,
        endTime: visit.endTime
      }))
    };

    await prisma.$disconnect();

    return NextResponse.json(debugInfo);
    
  } catch (error) {
    console.error('Debug planner error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
