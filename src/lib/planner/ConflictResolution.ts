import { VisitInfo, SchoolAvailabilityRule } from '../types';
import { format } from 'date-fns';

export interface ConflictResolutionResult {
  resolvedVisits: VisitInfo[];
  conflicts: ConflictInfo[];
  resolutions: ResolutionInfo[];
}

export interface ConflictInfo {
  type: 'overlap' | 'travel_time' | 'capacity';
  schoolIds: string[];
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ResolutionInfo {
  conflictId: string;
  action: 'postpone' | 'reschedule' | 'skip';
  affectedSchoolId: string;
  reason: string;
}

export interface TravelBuffer {
  bufferMinutes: number;
  maxTravelTime: number;
  zoneBasedTravel: { [zipCode: string]: number };
}

export class ConflictResolution {
  private static readonly DEFAULT_TRAVEL_BUFFER = 15; // minutes
  private static readonly DEFAULT_MAX_TRAVEL_TIME = 45; // minutes

  static resolveConflicts(
    candidates: VisitInfo[],
    travelBuffer?: Partial<TravelBuffer>
  ): ConflictResolutionResult {
    const conflicts: ConflictInfo[] = [];
    const resolutions: ResolutionInfo[] = [];

    // 1. Check for time overlaps
    const overlapConflicts = this.detectOverlaps(candidates);
    conflicts.push(...overlapConflicts);

    // 2. Check for travel time conflicts
    const travelConflicts = this.detectTravelConflicts(candidates, travelBuffer);
    conflicts.push(...travelConflicts);

    // 3. Check capacity constraints
    const capacityConflicts = this.detectCapacityConflicts(candidates);
    conflicts.push(...capacityConflicts);

    // 4. Resolve conflicts
    const resolvedVisits = this.applyResolutions(candidates, conflicts, resolutions);

    return {
      resolvedVisits,
      conflicts,
      resolutions
    };
  }

  private static detectOverlaps(candidates: VisitInfo[]): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    
    // Group by date
    const visitsByDate = this.groupByDate(candidates);
    
    for (const [dateStr, dayVisits] of Object.entries(visitsByDate)) {
      const sortedVisits = dayVisits.sort((a, b) => {
        const timeA = this.timeToMinutes(a.startTime || "00:00");
        const timeB = this.timeToMinutes(b.startTime || "00:00");
        return timeA - timeB;
      });

      for (let i = 0; i < sortedVisits.length - 1; i++) {
        const current = sortedVisits[i];
        const next = sortedVisits[i + 1];
        
        const currentEnd = this.timeToMinutes(current.endTime || "00:00");
        const nextStart = this.timeToMinutes(next.startTime || "00:00");
        
        if (nextStart < currentEnd) {
          conflicts.push({
            type: 'overlap',
            schoolIds: [current.schoolId, next.schoolId],
            description: `${current.schoolName} and ${next.schoolName} have overlapping schedules`,
            severity: 'high'
          });
        }
      }
    }

    return conflicts;
  }

  private static detectTravelConflicts(
    candidates: VisitInfo[],
    travelBuffer?: Partial<TravelBuffer>
  ): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    const buffer = travelBuffer?.bufferMinutes || this.DEFAULT_TRAVEL_BUFFER;
    
    const visitsByDate = this.groupByDate(candidates);
    
    for (const [dateStr, dayVisits] of Object.entries(visitsByDate)) {
      const sortedVisits = dayVisits.sort((a, b) => {
        const timeA = this.timeToMinutes(a.startTime || "00:00");
        const timeB = this.timeToMinutes(b.startTime || "00:00");
        return timeA - timeB;
      });

      for (let i = 0; i < sortedVisits.length - 1; i++) {
        const current = sortedVisits[i];
        const next = sortedVisits[i + 1];
        
        const currentEnd = this.timeToMinutes(current.endTime || "00:00");
        const nextStart = this.timeToMinutes(next.startTime || "00:00");
        const travelTime = this.calculateTravelTime(current.zipCode, next.zipCode, travelBuffer);
        
        if (nextStart - currentEnd < travelTime + buffer) {
          conflicts.push({
            type: 'travel_time',
            schoolIds: [current.schoolId, next.schoolId],
            description: `Insufficient travel time between ${current.schoolName} and ${next.schoolName}`,
            severity: 'medium'
          });
        }
      }
    }

    return conflicts;
  }

  private static detectCapacityConflicts(candidates: VisitInfo[]): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    const maxVisitsPerDay = 4; // Configurable
    
    const visitsByDate = this.groupByDate(candidates);
    
    for (const [dateStr, dayVisits] of Object.entries(visitsByDate)) {
      if (dayVisits.length > maxVisitsPerDay) {
        conflicts.push({
          type: 'capacity',
          schoolIds: dayVisits.map(v => v.schoolId),
          description: `Too many visits scheduled for ${format(new Date(dateStr), 'MMM d')}`,
          severity: 'medium'
        });
      }
    }

    return conflicts;
  }

  private static applyResolutions(
    candidates: VisitInfo[],
    conflicts: ConflictInfo[],
    resolutions: ResolutionInfo[]
  ): VisitInfo[] {
    let resolvedVisits = [...candidates];

    // Sort conflicts by severity (high first)
    const sortedConflicts = conflicts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    for (const conflict of sortedConflicts) {
      // For now, we'll drop the lower priority visit in conflicts
      // In a more sophisticated system, we would try to reschedule
      const conflictId = `${conflict.type}_${conflict.schoolIds.join('_')}`;
      
      if (conflict.type === 'overlap' || conflict.type === 'travel_time') {
        // Find the visit with lower priority to drop
        const conflictingVisits = resolvedVisits.filter(v => 
          conflict.schoolIds.includes(v.schoolId)
        );
        
        if (conflictingVisits.length >= 2) {
          const lowerPriorityVisit = conflictingVisits.reduce((prev, current) => 
            (prev.score || 0) < (current.score || 0) ? prev : current
          );
          
          resolvedVisits = resolvedVisits.filter(v => v.schoolId !== lowerPriorityVisit.schoolId);
          
          resolutions.push({
            conflictId,
            action: 'skip',
            affectedSchoolId: lowerPriorityVisit.schoolId,
            reason: `Removed due to ${conflict.type} conflict`
          });
        }
      }
    }

    return resolvedVisits;
  }

  private static groupByDate(visits: VisitInfo[]): { [date: string]: VisitInfo[] } {
    return visits.reduce((groups, visit) => {
      const dateStr = format(new Date(visit.date), 'yyyy-MM-dd');
      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }
      groups[dateStr].push(visit);
      return groups;
    }, {} as { [date: string]: VisitInfo[] });
  }

  private static timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private static calculateTravelTime(
    fromZip: string,
    toZip: string,
    travelBuffer?: Partial<TravelBuffer>
  ): number {
    // Simple zip code based travel time calculation
    // In production, this would use a real routing API
    
    const zoneTimes = travelBuffer?.zoneBasedTravel || {
      '33127': 15, '33138': 20, '33142': 25, '33146': 30, '33147': 35, '33150': 40
    };

    // If same zip code, minimal travel time
    if (fromZip === toZip) {
      return 5;
    }

    // Use zone-based travel times or default
    const fromTime = zoneTimes[fromZip] || 30;
    const toTime = zoneTimes[toZip] || 30;
    
    return Math.max(fromTime, toTime);
  }
}
