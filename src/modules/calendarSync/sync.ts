import { PrismaClient } from "@prisma/client";
import stringSimilarity from "string-similarity";
import { getGoogleCalendarClient } from "./client";
import { matchByName, normalizeSchoolName, NAME_MATCH_THRESHOLD } from "@/lib/schoolNames";
import type { GoogleCalendarEvent } from "@/lib/google/calendar";
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

/**
 * True when `name` reads as the school's own name rather than a person's —
 * same normalize-and-compare a calendar goes through to be pinned to a
 * school in the first place (matchByName below), so "Charles R. Drew K-8"
 * counts as the same name as "Dr. Charles R. Drew K-8 Center".
 *
 * Some school calendars are organized by the school's own shared account
 * rather than the teacher's, so `event.organizer.displayName` is literally
 * the school. Treating that as a teacher created a fake "Teacher" row named
 * after the school for 41 schools in one sync — see the 2026-09 cleanup.
 */
function looksLikeTheSchoolItself(name: string, schoolName: string): boolean {
  const a = normalizeSchoolName(name);
  const b = normalizeSchoolName(schoolName);
  if (!a || !b) return false;
  if (a === b) return true;
  // A combined-campus name ("Carrie P. Meek/Westview K-8") organizes under
  // just its first half, which similarity alone scores too low (0.67) — but a
  // long, word-bounded prefix match is exactly the same signal, not a coincidence.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 8 && new RegExp(`\\b${shorter}\\b`).test(longer)) return true;
  return stringSimilarity.compareTwoStrings(a, b) >= NAME_MATCH_THRESHOLD;
}

function extractTeacherNameFromEvent(event: GoogleCalendarEvent, schoolName: string): string | null {
  // `creator` is not on the declared type but Google does send it; the index
  // signature on GoogleCalendarEvent is what makes reading it type-safe.
  const creator = event.creator as { displayName?: string } | undefined;
  const fromOrganizer = event.organizer?.displayName || creator?.displayName || null;
  if (
    typeof fromOrganizer === "string" &&
    fromOrganizer.trim() &&
    !looksLikeTheSchoolItself(fromOrganizer, schoolName)
  ) {
    return fromOrganizer.trim();
  }

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
  // `status` is what GoogleCalendarError carries; `code`/`response.status` are
  // the shapes the previous googleapis client threw. Kept together so a stale
  // token still triggers a full resync rather than surfacing as a hard error.
  const anyErr = err as { status?: number; code?: number; response?: { status?: number } };
  return anyErr?.status === 410 || anyErr?.code === 410 || anyErr?.response?.status === 410;
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
        const teacherName = extractTeacherNameFromEvent(event, school.name);
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

// Every YMU school calendar is a shared secondary calendar, whose id always
// ends in "@group.calendar.google.com". A person's own calendar is their email
// address, and Google's holiday/birthday calendars sit under the different
// "@group.v.calendar.google.com" domain — so this one suffix cleanly separates
// "could be a school" from "definitely isn't".
const SCHOOL_CALENDAR_SUFFIX = "@group.calendar.google.com";

function isSchoolCalendarId(calendarId: string): boolean {
  return calendarId.endsWith(SCHOOL_CALENDAR_SUFFIX);
}

type MatchOutcome =
  | { matched: true }
  | { matched: false; reason: string; candidates?: { name: string; score: number }[] };

/**
 * Upsert a CalendarSyncIssue for a Google calendar the matcher could not pin,
 * or resolve one if a previously-unmatched calendar now has a match.
 */
async function trackCalendarMatch(
  prisma: PrismaClient,
  calendarId: string,
  calendarSummary: string | null,
  outcome: MatchOutcome
): Promise<void> {
  const openIssue = await prisma.calendarSyncIssue.findFirst({
    where: { calendarId, resolvedAt: null },
  });

  if (outcome.matched) {
    if (openIssue) {
      await prisma.calendarSyncIssue.update({
        where: { id: openIssue.id },
        data: { resolvedAt: new Date() },
      });
    }
    return;
  }

  const candidates = outcome.candidates?.length ? JSON.stringify(outcome.candidates) : null;

  if (openIssue) {
    // Re-running sync should refresh why it still failed, not leave the first
    // run's reason frozen in place.
    await prisma.calendarSyncIssue.update({
      where: { id: openIssue.id },
      data: { reason: outcome.reason, candidates, calendarSummary },
    });
    return;
  }

  await prisma.calendarSyncIssue.create({
    data: { calendarId, calendarSummary, reason: outcome.reason, candidates },
  });
}

/**
 * Sync all school calendars: list calendars from Google, resolve each to a
 * School (already-pinned googleCalendarId first, then normalized-name matching
 * with a school-level guard), then sync events for that school in the date
 * range and pin the calendar id if it wasn't already.
 *
 * Calendars that match nothing, or match ambiguously, are recorded in
 * CalendarSyncIssue with their top candidates for a human to resolve.
 */
export async function syncAllSchoolCalendars(
  prisma: PrismaClient,
  dateRangeStart: Date,
  dateRangeEnd: Date,
  options?: { createSchoolIfMissing?: boolean; forceFullSync?: boolean }
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

  // An issue is only ever resolved below when its calendar matches a school —
  // so a row outlives whatever caused it, and the queue fills with problems
  // that no longer exist: the calendar was deleted in Google, or it was never
  // a school calendar and an older run flagged it before that filter existed.
  // Keeping only calendars still worth reviewing closes both.
  //
  // This runs before the per-calendar loop, not after, because an incremental
  // sync spends minutes making Google calls without touching the database —
  // long enough for Neon's pooler to drop an idle connection, which made the
  // same query fail with P1017 every time when it sat at the end.
  const reviewable = calendars.map((c) => c.id).filter(isSchoolCalendarId);
  const stale = await prisma.calendarSyncIssue.updateMany({
    where: { resolvedAt: null, calendarId: { notIn: reviewable } },
    data: { resolvedAt: new Date() },
  });
  if (stale.count > 0 && process.env.NODE_ENV !== "production") {
    console.log(`Closed ${stale.count} stale issue(s): calendar gone or not a school calendar.`);
  }

  const schools = await prisma.school.findMany({
    where: { active: true },
    select: { id: true, name: true, googleCalendarId: true },
  });
  if (process.env.NODE_ENV !== "production" && schools.length > 0) {
    console.log(`Schools in DB: ${schools.length}. Matching by calendar name...`);
  }

  // Pin-then-skip: a calendar already linked to a school never goes back
  // through the matcher. After the YMU-A import nearly every school arrives
  // pre-pinned, so the fuzzy path below only ever sees genuinely new calendars.
  const byCalendarId = new Map(
    schools.filter((s) => s.googleCalendarId).map((s) => [s.googleCalendarId as string, s])
  );
  // Only unpinned schools are matchable — a school already bound to another
  // calendar must not be stolen by a similarly-named one.
  const unpinned = schools.filter((s) => !s.googleCalendarId);

  for (const cal of calendars) {
    const summary = cal.summary?.trim();
    if (!summary) continue;
    // Google hands the service account more than school calendars: the owner's
    // own calendar (schedule@ymu.org) and auto-subscribed holiday calendars
    // (en.usa#holiday@group.v.calendar.google.com). Flagging those as
    // "unmatched school" every run buries the real problems in the queue.
    if (!isSchoolCalendarId(cal.id)) continue;

    let school = byCalendarId.get(cal.id) ?? null;

    if (!school) {
      const match = matchByName(summary, unpinned, (s) => s.name);
      if (match.status === "matched") {
        school = match.item;
        // Remove it from the pool so a second, similarly-named calendar in the
        // same run cannot match the same school.
        unpinned.splice(unpinned.indexOf(match.item), 1);
      } else {
        await trackCalendarMatch(prisma, cal.id, cal.summary ?? null, {
          matched: false,
          reason: match.status === "ambiguous" ? "AMBIGUOUS_MATCH" : "NO_MATCHING_SCHOOL",
          candidates: match.candidates.map((c) => ({ name: c.item.name, score: c.score })),
        });
      }
    }

    if (!school) {
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
          forceFullSync: options?.forceFullSync,
        });
        result.schoolMatched += 1;
        result.eventsProcessed += subResult.eventsProcessed;
        result.sessionsCreated += subResult.sessionsCreated;
        result.sessionsUpdated += subResult.sessionsUpdated;
        result.errors.push(...subResult.errors);
      }
      continue;
    }

    await trackCalendarMatch(prisma, cal.id, cal.summary ?? null, { matched: true });

    if (!school.googleCalendarId) {
      await prisma.school.update({
        where: { id: school.id },
        data: { googleCalendarId: cal.id },
      });
    }

    result.schoolMatched += 1;
    const subResult = await syncSchoolCalendar(prisma, school.id, dateRangeStart, dateRangeEnd, {
      calendarIdOverride: cal.id,
      forceFullSync: options?.forceFullSync,
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
  // Back up to Monday. The planner renders a whole Mon–Fri week, so starting
  // at "today" leaves the days already past in the current week with no
  // sessions at all — every school on them looks like it has no class.
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);

  const end = new Date(start);
  end.setDate(end.getDate() + defaultWeeksAhead * 7);
  return { start, end };
}
