import { PrismaClient } from "@prisma/client";
import { getGoogleCalendarClient } from "./client";
import type { SyncResult } from "./types";

const defaultWeeksAhead = 12;

/**
 * Get or create a Subject by name.
 */
async function getOrCreateSubject(prisma: PrismaClient, name: string): Promise<string> {
  const trimmed = name.trim() || "Unnamed";
  const existing = await prisma.subject.findUnique({ where: { name: trimmed } });
  if (existing) return existing.id;
  const created = await prisma.subject.create({
    data: { name: trimmed },
  });
  return created.id;
}

async function getOrCreateTeacher(
  prisma: PrismaClient,
  schoolId: string,
  name: string
): Promise<string> {
  const trimmed = name.trim();
  const existing = await prisma.teacher.findFirst({
    where: {
      name: trimmed,
      school: { id: schoolId },
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.teacher.create({
    data: {
      name: trimmed,
      school: { connect: { id: schoolId } },
    },
    select: { id: true },
  });
  return created.id;
}

function extractTeacherNameFromEvent(event: any): string | null {
  const fromOrganizer =
    event?.organizer?.displayName ||
    event?.creator?.displayName ||
    null;
  if (typeof fromOrganizer === "string" && fromOrganizer.trim()) return fromOrganizer.trim();

  const desc = typeof event?.description === "string" ? event.description : "";
  const m = desc.match(/teacher\s*:\s*(.+)/i) || desc.match(/profesor\s*:\s*(.+)/i);
  if (m?.[1]) {
    const line = m[1].split(/\r?\n/)[0]?.trim();
    if (line) return line;
  }
  return null;
}

/** Google returns HTTP 410 when a syncToken has expired/is invalid — caller must do a full resync. */
function isGoneError(err: unknown): boolean {
  const anyErr = err as { code?: number; response?: { status?: number } };
  return anyErr?.code === 410 || anyErr?.response?.status === 410;
}

/**
 * Sync a single school's calendar (by school id) in the given date range.
 * Uses optional calendarIdOverride (e.g. from listCalendars) or school.googleCalendarId.
 *
 * Incremental sync: if the School has a stored `calendarSyncToken`, uses it
 * instead of a time-bounded full pull (Google Calendar API requires omitting
 * timeMin/timeMax/orderBy when a syncToken is supplied). Falls back to a full
 * resync when Google reports the token expired (HTTP 410).
 */
export async function syncSchoolCalendar(
  prisma: PrismaClient,
  schoolId: string,
  dateRangeStart: Date,
  dateRangeEnd: Date,
  options?: { calendarIdOverride?: string; forceFullSync?: boolean }
): Promise<SyncResult> {
  const result: SyncResult = {
    calendarCount: 0,
    schoolMatched: 0,
    eventsProcessed: 0,
    sessionsCreated: 0,
    sessionsUpdated: 0,
    errors: [],
  };

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
  });
  if (!school) {
    result.errors.push(`School not found: ${schoolId}`);
    return result;
  }

  const calendarIdToUse =
    options?.calendarIdOverride ?? school.googleCalendarId ?? null;
  if (!calendarIdToUse) {
    result.errors.push(
      `School "${school.name}" has no googleCalendarId; run full sync first to match by calendar name.`
    );
    return result;
  }
  const calendarLabel = school.name;
  const auth = getGoogleCalendarClient();
  const useSyncToken = !options?.forceFullSync && !!school.calendarSyncToken;

  try {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    result.calendarCount = 1;
    result.schoolMatched = 1;

    do {
      const res = await auth.events.list(
        useSyncToken
          ? {
              calendarId: calendarIdToUse as string,
              syncToken: school.calendarSyncToken!,
              singleEvents: true,
              pageToken,
            }
          : {
              // NOTE: orderBy is intentionally omitted — Google Calendar API
              // does not return a nextSyncToken on a listing that specifies
              // orderBy, which would prevent incremental sync from ever
              // kicking in. Processing order doesn't matter here since every
              // event in the page is upserted independently.
              calendarId: calendarIdToUse as string,
              timeMin: dateRangeStart.toISOString(),
              timeMax: dateRangeEnd.toISOString(),
              singleEvents: true,
              pageToken,
            }
      );

      const events = res.data.items ?? [];
      result.eventsProcessed += events.length;
      pageToken = res.data.nextPageToken ?? undefined;
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;

      for (const event of events) {
        if (!event.id) continue;

        if (event.status === "cancelled") {
          const deleted = await prisma.classSession.deleteMany({
            where: { googleCalendarId: calendarIdToUse as string, googleEventId: event.id },
          });
          if (deleted.count > 0) result.sessionsUpdated += 1;
          continue;
        }

        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;
        if (!start || !end) {
          result.errors.push(`Event ${event.id} has no dateTime, skipping`);
          continue;
        }
        const startDate = new Date(start);
        const endDate = new Date(end);
        const subjectName = (event.summary ?? "").trim() || "Unnamed";
        const subjectId = await getOrCreateSubject(prisma, subjectName);
        const teacherName = extractTeacherNameFromEvent(event);
        const teacherId = teacherName
          ? await getOrCreateTeacher(prisma, schoolId, teacherName)
          : null;

        const existing = await prisma.classSession.findUnique({
          where: {
            googleCalendarId_googleEventId: {
              googleCalendarId: calendarIdToUse as string,
              googleEventId: event.id,
            },
          },
        });

        if (existing) {
          await prisma.classSession.update({
            where: { id: existing.id },
            data: {
              startDateTime: startDate,
              endDateTime: endDate,
              subjectId,
              ...(teacherId ? { teacherId } : {}),
            },
          });
          result.sessionsUpdated += 1;
        } else {
          await prisma.classSession.create({
            data: {
              schoolId,
              subjectId,
              ...(teacherId ? { teacherId } : {}),
              startDateTime: startDate,
              endDateTime: endDate,
              googleCalendarId: calendarIdToUse as string,
              googleEventId: event.id,
            },
          });
          result.sessionsCreated += 1;
        }
      }
    } while (pageToken);

    await prisma.school.update({
      where: { id: schoolId },
      data: {
        calendarSyncToken: nextSyncToken ?? school.calendarSyncToken ?? null,
        calendarLastSyncedAt: new Date(),
      },
    });
  } catch (err) {
    if (isGoneError(err) && !options?.forceFullSync) {
      // Token expired — clear it and do a full resync for this school.
      await prisma.school.update({ where: { id: schoolId }, data: { calendarSyncToken: null } });
      return syncSchoolCalendar(prisma, schoolId, dateRangeStart, dateRangeEnd, {
        ...options,
        forceFullSync: true,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`Calendar ${calendarLabel}: ${message}`);
  }

  return result;
}

/**
 * Upsert a CalendarSyncIssue for a Google calendar with no matching School,
 * or resolve one if a previously-unmatched calendar now has a match.
 */
async function trackCalendarMatch(
  prisma: PrismaClient,
  calendarId: string,
  calendarSummary: string | null,
  matched: boolean
): Promise<void> {
  const openIssue = await prisma.calendarSyncIssue.findFirst({
    where: { calendarId, resolvedAt: null },
  });

  if (matched) {
    if (openIssue) {
      await prisma.calendarSyncIssue.update({
        where: { id: openIssue.id },
        data: { resolvedAt: new Date() },
      });
    }
    return;
  }

  if (!openIssue) {
    await prisma.calendarSyncIssue.create({
      data: { calendarId, calendarSummary, reason: "NO_MATCHING_SCHOOL" },
    });
  }
}

/**
 * Sync all school calendars: list calendars from Google, match by summary === School.name,
 * then sync events for each matched school in the date range.
 * Schools without a matching calendar are skipped. Optionally update School.googleCalendarId when matched.
 * Calendars with no matching active School are recorded in CalendarSyncIssue for review.
 */
export async function syncAllSchoolCalendars(
  prisma: PrismaClient,
  dateRangeStart: Date,
  dateRangeEnd: Date,
  options?: { createSchoolIfMissing?: boolean }
): Promise<SyncResult> {
  const result: SyncResult = {
    calendarCount: 0,
    schoolMatched: 0,
    eventsProcessed: 0,
    sessionsCreated: 0,
    sessionsUpdated: 0,
    errors: [],
  };

  let calendars: { id: string; summary: string | null }[];
  try {
    const { listCalendars } = await import("./client");
    calendars = await listCalendars();
    if (process.env.NODE_ENV !== "production") {
      console.log(`Calendars listed: ${calendars.length}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`List calendars: ${message}`);
    if (process.env.NODE_ENV !== "production") {
      console.error("List calendars error:", err);
    }
    return result;
  }

  result.calendarCount = calendars.length;
  const schools = await prisma.school.findMany({
    where: { active: true },
    select: { id: true, name: true, googleCalendarId: true },
  });
  if (process.env.NODE_ENV !== "production" && schools.length > 0) {
    console.log(`Schools in DB: ${schools.length}. Matching by calendar name...`);
  }

  for (const cal of calendars) {
    const summary = cal.summary?.trim();
    if (!summary) continue;

    const school = schools.find((s) => s.name.trim() === summary);
    if (!school) {
      await trackCalendarMatch(prisma, cal.id, cal.summary ?? null, false);
      if (options?.createSchoolIfMissing) {
        const created = await prisma.school.create({
          data: {
            name: summary,
            zipCode: "00000",
            availability: "[]",
            googleCalendarId: cal.id,
          },
        });
        const subResult = await syncSchoolCalendar(prisma, created.id, dateRangeStart, dateRangeEnd, {
          calendarIdOverride: cal.id,
        });
        result.schoolMatched += 1;
        result.eventsProcessed += subResult.eventsProcessed;
        result.sessionsCreated += subResult.sessionsCreated;
        result.sessionsUpdated += subResult.sessionsUpdated;
        result.errors.push(...subResult.errors);
      }
      continue;
    }

    await trackCalendarMatch(prisma, cal.id, cal.summary ?? null, true);

    if (!school.googleCalendarId) {
      await prisma.school.update({
        where: { id: school.id },
        data: { googleCalendarId: cal.id },
      });
    }

    result.schoolMatched += 1;
    const subResult = await syncSchoolCalendar(prisma, school.id, dateRangeStart, dateRangeEnd, {
      calendarIdOverride: cal.id,
    });
    result.eventsProcessed += subResult.eventsProcessed;
    result.sessionsCreated += subResult.sessionsCreated;
    result.sessionsUpdated += subResult.sessionsUpdated;
    result.errors.push(...subResult.errors);
  }

  return result;
}

/**
 * Default date range: from now, next defaultWeeksAhead weeks.
 */
export function getDefaultSyncRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + defaultWeeksAhead * 7);
  return { start, end };
}
