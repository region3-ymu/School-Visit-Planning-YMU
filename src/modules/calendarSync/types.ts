/**
 * Result of a calendar sync run.
 */
export interface SyncResult {
  calendarCount: number;
  schoolMatched: number;
  eventsProcessed: number;
  sessionsCreated: number;
  sessionsUpdated: number;
  errors: string[];
}
