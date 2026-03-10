import { PrismaClient } from '@prisma/client';
import { format } from 'date-fns';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  userId?: string;
  details: AuditDetails;
  previousState?: any;
  newState?: any;
  reason?: string;
}

export type AuditAction = 
  | 'create' | 'update' | 'delete' | 'pin' | 'skip' | 'postpone' 
  | 'confirm' | 'reschedule' | 'import' | 'export' | 'generate_plan';

export type AuditEntityType = 
  | 'school' | 'visit' | 'schedule' | 'override' | 'calendar' | 'import_batch';

export interface AuditDetails {
  description: string;
  metadata?: Record<string, any>;
  impact?: 'low' | 'medium' | 'high';
  automated?: boolean;
}

export class AuditTrail {
  private static prisma = new PrismaClient();

  static async logAction(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      // For now, we'll store audit logs in a simple structure
      // In production, this would be a dedicated audit table
      const auditEntry = {
        ...entry,
        timestamp: new Date(),
        id: this.generateId()
      };

      // Log to console for now (in production, save to database)
      console.log('AUDIT:', JSON.stringify(auditEntry, null, 2));

      // Store in database if we have audit table
      // await this.prisma.auditLog.create({ data: auditEntry });
    } catch (error) {
      console.error('Failed to log audit entry:', error);
    }
  }

  static async logOverride(
    action: 'pin' | 'skip' | 'postpone',
    schoolId: string,
    schoolName: string,
    details: {
      originalDate?: Date;
      newDate?: Date;
      reason: string;
      userId?: string;
    }
  ): Promise<void> {
    await this.logAction({
      action,
      entityType: 'override',
      entityId: schoolId,
      userId: details.userId,
      details: {
        description: `${action} override for ${schoolName}`,
        metadata: {
          schoolName,
          originalDate: details.originalDate,
          newDate: details.newDate,
          reason: details.reason
        },
        impact: 'medium'
      }
    });
  }

  static async logVisitConfirmation(
    schoolId: string,
    schoolName: string,
    visitDate: Date,
    notes?: string,
    userId?: string
  ): Promise<void> {
    await this.logAction({
      action: 'confirm',
      entityType: 'visit',
      entityId: schoolId,
      userId,
      details: {
        description: `Visit confirmed for ${schoolName}`,
        metadata: {
          schoolName,
          visitDate,
          notes
        },
        impact: 'low'
      }
    });
  }

  static async logPlanGeneration(
    weekStartDate: Date,
    totalVisits: number,
    overridesCount: number,
    userId?: string
  ): Promise<void> {
    await this.logAction({
      action: 'generate_plan',
      entityType: 'schedule',
      entityId: format(weekStartDate, 'yyyy-MM-dd'),
      userId,
      details: {
        description: `Weekly plan generated for ${format(weekStartDate, 'MMM d')}`,
        metadata: {
          weekStartDate,
          totalVisits,
          overridesCount
        },
        impact: 'medium',
        automated: true
      }
    });
  }

  static async logImport(
    entityType: 'school' | 'calendar',
    recordsCount: number,
    errorsCount: number,
    userId?: string
  ): Promise<void> {
    const mappedType: AuditEntityType = entityType === 'school' ? 'school' : 'calendar';
    
    await this.logAction({
      action: 'import',
      entityType: mappedType,
      entityId: `batch_${Date.now()}`,
      userId,
      details: {
        description: `Imported ${recordsCount} ${entityType} records`,
        metadata: {
          recordsCount,
          errorsCount,
          successRate: recordsCount > 0 ? ((recordsCount - errorsCount) / recordsCount * 100).toFixed(1) : '0'
        },
        impact: errorsCount > 0 ? 'medium' : 'low'
      }
    });
  }

  static async getAuditHistory(
    entityType?: string,
    entityId?: string,
    limit: number = 50
  ): Promise<AuditLogEntry[]> {
    // This would query the audit table in production
    // For now, return empty array
    return [];
  }

  static async explainWhySchoolNotScheduled(
    schoolId: string,
    schoolName: string,
    weekStartDate: Date,
    reasons: string[]
  ): Promise<void> {
    await this.logAction({
      action: 'generate_plan',
      entityType: 'schedule',
      entityId: format(weekStartDate, 'yyyy-MM-dd'),
      details: {
        description: `School not scheduled: ${schoolName}`,
        metadata: {
          schoolId,
          schoolName,
          weekStartDate: format(weekStartDate, 'yyyy-MM-dd'),
          reasons
        },
        impact: 'low',
        automated: true
      }
    });
  }

  private static generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Utility functions for audit analysis
export class AuditAnalyzer {
  static async getOverridePatterns(schoolId: string, weeks: number = 4): Promise<{
    skipFrequency: number;
    postponeFrequency: number;
    pinFrequency: number;
    lastActions: AuditLogEntry[];
  }> {
    // Analyze override patterns for a specific school
    return {
      skipFrequency: 0,
      postponeFrequency: 0,
      pinFrequency: 0,
      lastActions: []
    };
  }

  static async getSystemHealth(): Promise<{
    totalActions: number;
    errorRate: number;
    mostCommonActions: { action: string; count: number }[];
    recentActivity: AuditLogEntry[];
  }> {
    // System health metrics from audit logs
    return {
      totalActions: 0,
      errorRate: 0,
      mostCommonActions: [],
      recentActivity: []
    };
  }
}
