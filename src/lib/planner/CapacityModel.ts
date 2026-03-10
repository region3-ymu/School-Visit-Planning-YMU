export interface ManagerCapacity {
  maxVisitsPerDay: number;
  maxVisitsPerWeek: number;
  earliestStart: string; // "09:00"
  latestFinish: string; // "15:30"
  unavailableDays: string[]; // ["2024-03-15", "2024-03-16"]
  preferredZones: string[]; // ["33127", "33138"]
  avoidBackToBackIfFar: boolean;
  reserveEmergencySlot: boolean;
  travelBufferMinutes: number;
  adminDays: number[]; // [1, 5] for Monday, Friday
  meetingDays: number[]; // [3] for Wednesday
}

export interface CapacityConstraints {
  dailyLimit: number;
  weeklyLimit: number;
  timeWindow: { start: string; end: string };
  zonePreferences: string[];
  travelConstraints: {
    bufferMinutes: number;
    avoidBackToBackFar: boolean;
  };
  reservedSlots: {
    emergency: boolean;
    admin: boolean;
  };
}

export class CapacityModel {
  private static readonly DEFAULT_CAPACITY: ManagerCapacity = {
    maxVisitsPerDay: 4,
    maxVisitsPerWeek: 11,
    earliestStart: "09:00",
    latestFinish: "15:30",
    unavailableDays: [],
    preferredZones: [],
    avoidBackToBackIfFar: true,
    reserveEmergencySlot: true,
    travelBufferMinutes: 15,
    adminDays: [1, 5], // Monday, Friday
    meetingDays: [3] // Wednesday
  };

  static getCapacity(customCapacity?: Partial<ManagerCapacity>): CapacityConstraints {
    const capacity = { ...this.DEFAULT_CAPACITY, ...customCapacity };
    
    return {
      dailyLimit: capacity.maxVisitsPerDay,
      weeklyLimit: capacity.maxVisitsPerWeek,
      timeWindow: {
        start: capacity.earliestStart,
        end: capacity.latestFinish
      },
      zonePreferences: capacity.preferredZones,
      travelConstraints: {
        bufferMinutes: capacity.travelBufferMinutes,
        avoidBackToBackFar: capacity.avoidBackToBackIfFar
      },
      reservedSlots: {
        emergency: capacity.reserveEmergencySlot,
        admin: capacity.adminDays.length > 0
      }
    };
  }

  static isDayAvailable(
    date: Date,
    capacity: ManagerCapacity
  ): boolean {
    const dateStr = date.toISOString().split('T')[0];
    
    // Check if day is unavailable
    if (capacity.unavailableDays.includes(dateStr)) {
      return false;
    }

    // Check if it's an admin day (reduced capacity)
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ...
    if (capacity.adminDays.includes(dayOfWeek)) {
      return true; // Available but with reduced capacity
    }

    // Check if it's a meeting day (no visits)
    if (capacity.meetingDays.includes(dayOfWeek)) {
      return false;
    }

    return true;
  }

  static getDailyCapacity(
    date: Date,
    capacity: Partial<ManagerCapacity>
  ): number {
    // Merge with defaults
    const managerCapacity = { ...this.DEFAULT_CAPACITY, ...capacity };

    const dateStr = date.toISOString().split('T')[0];
    
    // If day is unavailable, no capacity
    if (managerCapacity.unavailableDays.includes(dateStr)) {
      return 0;
    }

    const dayOfWeek = date.getDay();
    
    // If it's a meeting day, no capacity
    if (managerCapacity.meetingDays.includes(dayOfWeek)) {
      return 0;
    }

    // If it's an admin day, reduced capacity
    if (managerCapacity.adminDays.includes(dayOfWeek)) {
      return Math.max(1, Math.floor(managerCapacity.maxVisitsPerDay * 0.5));
    }

    // Normal day capacity
    return managerCapacity.maxVisitsPerDay;
  }

  static validateSchedule(
    visits: any[],
    capacity: ManagerCapacity
  ): {
    isValid: boolean;
    violations: CapacityViolation[];
    suggestions: string[];
  } {
    const violations: CapacityViolation[] = [];
    const suggestions: string[] = [];

    // Check daily limits
    const visitsByDate = this.groupByDate(visits);
    for (const [dateStr, dayVisits] of Object.entries(visitsByDate)) {
      const date = new Date(dateStr);
      const dailyCapacity = this.getDailyCapacity(date, capacity);
      
      if (dayVisits.length > dailyCapacity) {
        violations.push({
          type: 'daily_limit_exceeded',
          date: dateStr,
          actual: dayVisits.length,
          limit: dailyCapacity,
          severity: 'high'
        });
      }

      // Check time window violations
      for (const visit of dayVisits) {
        if (visit.startTime && visit.endTime) {
          const start = this.timeToMinutes(visit.startTime);
          const end = this.timeToMinutes(visit.endTime);
          const windowStart = this.timeToMinutes(capacity.earliestStart);
          const windowEnd = this.timeToMinutes(capacity.latestFinish);

          if (start < windowStart || end > windowEnd) {
            violations.push({
              type: 'time_window_violation',
              date: dateStr,
              schoolId: visit.schoolId,
              actualTime: `${visit.startTime}-${visit.endTime}`,
              window: `${capacity.earliestStart}-${capacity.latestFinish}`,
              actual: `${visit.startTime}-${visit.endTime}`,
              limit: `${capacity.earliestStart}-${capacity.latestFinish}`,
              severity: 'medium'
            });
          }
        }
      }
    }

    // Check weekly limit
    const totalVisits = visits.length;
    if (totalVisits > capacity.maxVisitsPerWeek) {
      violations.push({
        type: 'weekly_limit_exceeded',
        actual: totalVisits,
        limit: capacity.maxVisitsPerWeek,
        severity: 'high'
      });
    }

    // Generate suggestions
    if (violations.length === 0) {
      suggestions.push('Schedule complies with all capacity constraints');
    } else {
      suggestions.push('Consider rescheduling some visits to comply with capacity limits');
      
      if (violations.some(v => v.type === 'daily_limit_exceeded')) {
        suggestions.push('Some days exceed the maximum number of visits');
      }
      
      if (violations.some(v => v.type === 'time_window_violation')) {
        suggestions.push('Some visits are outside the preferred time window');
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
      suggestions
    };
  }

  private static groupByDate(visits: any[]): { [date: string]: any[] } {
    return visits.reduce((groups, visit) => {
      const dateStr = new Date(visit.date).toISOString().split('T')[0];
      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }
      groups[dateStr].push(visit);
      return groups;
    }, {} as { [date: string]: any[] });
  }

  private static timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}

export interface CapacityViolation {
  type: 'daily_limit_exceeded' | 'weekly_limit_exceeded' | 'time_window_violation';
  date?: string;
  schoolId?: string;
  actual?: number | string;
  limit?: number | string;
  actualTime?: string;
  window?: string;
  severity: 'low' | 'medium' | 'high';
}
