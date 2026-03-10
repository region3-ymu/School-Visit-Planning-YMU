import { School, CalendarDay } from '@prisma/client';
import { differenceInDays, format } from 'date-fns';
import { SchoolAvailabilityRule, DayType, VisitInfo } from '../types';

export interface EligibilityResult {
  schoolId: string;
  isEligible: boolean;
  reason: string;
  disqualificationReason?: string;
  priority: number;
}

export class EligibilityEngine {
  static checkEligibility(
    school: School & { visitLogs: any[] },
    day: { date: Date; dayType: DayType },
    manualOverrides: Partial<VisitInfo>[],
    targetDate: Date
  ): EligibilityResult {
    // 1. Hard Constraints
    const hardConstraintCheck = this.checkHardConstraints(school, day, manualOverrides, targetDate);
    if (!hardConstraintCheck.isEligible) {
      return hardConstraintCheck;
    }

    // 2. Calculate priority based on urgency and need
    const priority = this.calculatePriority(school, targetDate);
    
    return {
      schoolId: school.id,
      isEligible: true,
      reason: this.getEligibilityReason(school, targetDate, priority),
      priority
    };
  }

  private static checkHardConstraints(
    school: School & { visitLogs: any[] },
    day: { date: Date; dayType: DayType },
    manualOverrides: Partial<VisitInfo>[],
    targetDate: Date
  ): EligibilityResult {
    // Check if school was manually skipped for this day
    const skipOverride = manualOverrides.find(o =>
      o.schoolId === school.id &&
      o.date &&
      format(new Date(o.date), 'yyyy-MM-dd') === format(targetDate, 'yyyy-MM-dd') &&
      o.isSkipped
    );

    if (skipOverride) {
      return {
        schoolId: school.id,
        isEligible: false,
        reason: 'Manually skipped',
        disqualificationReason: 'School was manually skipped for this date',
        priority: 0
      };
    }

    // Check if school is pinned to a different day this week
    const pinnedOverride = manualOverrides.find(o =>
      o.schoolId === school.id &&
      o.isPinned &&
      o.date &&
      format(new Date(o.date), 'yyyy-MM-dd') !== format(targetDate, 'yyyy-MM-dd')
    );

    if (pinnedOverride) {
      return {
        schoolId: school.id,
        isEligible: false,
        reason: 'Pinned to different day',
        disqualificationReason: 'School is pinned to a different day this week',
        priority: 0
      };
    }

    // Check availability rules
    let rules: SchoolAvailabilityRule[] = [];
    try {
      rules = JSON.parse(school.availability);
    } catch (e) {
      return {
        schoolId: school.id,
        isEligible: false,
        reason: 'Invalid availability rules',
        disqualificationReason: 'School availability rules are malformed',
        priority: 0
      };
    }

    const weekdayName = format(targetDate, 'EEEE');
    const hasAvailability = rules.some(r => 
      r.dayType === day.dayType || r.weekday === weekdayName
    );

    if (!hasAvailability) {
      return {
        schoolId: school.id,
        isEligible: false,
        reason: 'No availability',
        disqualificationReason: `School has no availability for ${day.dayType} day or ${weekdayName}`,
        priority: 0
      };
    }

    return { schoolId: school.id, isEligible: true, reason: 'Eligible', priority: 0 };
  }

  private static calculatePriority(
    school: School & { visitLogs: any[] },
    targetDate: Date
  ): number {
    const lastVisit = school.visitLogs[0] ? school.visitLogs[0].date : null;
    const daysSinceVisit = lastVisit ? differenceInDays(targetDate, lastVisit) : 100;

    // Frequency-based priority
    const freqLimit = this.getFrequencyDays(school.frequencyTarget);
    const isOverdue = daysSinceVisit >= freqLimit;

    if (isOverdue) {
      return 100 + (daysSinceVisit - freqLimit) * 5; // Higher priority for overdue
    }

    return Math.max(1, daysSinceVisit); // Base priority on days since last visit
  }

  private static getEligibilityReason(
    school: School & { visitLogs: any[] },
    targetDate: Date,
    priority: number
  ): string {
    const lastVisit = school.visitLogs[0] ? school.visitLogs[0].date : null;
    const daysSinceVisit = lastVisit ? differenceInDays(targetDate, lastVisit) : 100;
    const freqLimit = this.getFrequencyDays(school.frequencyTarget);

    if (daysSinceVisit >= 90) {
      return "Action Required (Never Visited)";
    } else if (daysSinceVisit >= freqLimit) {
      return `Overdue by ${daysSinceVisit - freqLimit} days`;
    } else {
      return `Due in ${freqLimit - daysSinceVisit} days`;
    }
  }

  private static getFrequencyDays(target: string): number {
    switch (target) {
      case "weekly": return 7;
      case "bi-weekly": return 14;
      case "monthly": return 30;
      default: return 14;
    }
  }
}
