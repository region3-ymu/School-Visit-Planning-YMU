import type { PrismaClient } from "@prisma/client";
import { getDefaultSyncRange } from "@/modules/calendarSync";

/**
 * SVP's classes, from YMU-A (#53).
 *
 * This used to be src/modules/calendarSync: every school calendar read from
 * Google, once a day at 7 AM, ~60 s even with nothing new. A class added
 * after 7 AM reached the planner the next morning (Orchard Villa, 2026-10-14).
 * YMU-A already mirrors every school calendar every 5 minutes, and both apps
 * key a class by the same Google calendar + event id, so SVP now asks YMU-A
 * for what changed since it last asked — usually a handful of rows.
 *
 * When it runs: on opening the planner or dashboard (at most once every
 * THROTTLE_MS, however many people open it), from the "Refresh classes"
 * button (now), and in the daily cron as a backstop.
 */

const FEED_KEY = "ymua-class-feed";
const THROTTLE_MS = 5 * 60_000;

type FeedEvent = {
  calendar_id: string | null;
  google_event_id: string | null;
  school_id: string | null;
  summary: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string | null;
  all_day: boolean | null;
  teachers: { id: string; name: string }[];
};

type FeedPage = { events: FeedEvent[]; cursor: string | null; hasMore: boolean };

export type PullResult =
  | { skipped: true; lastRunAt: string }
  | { skipped: false; created: number; updated: number; removed: number; unchanged: number; ignored: number };

async function fetchFeed(from: Date, to: Date, since: string | null): Promise<FeedPage> {
  const base = (process.env.YMUA_APP_URL ?? "https://ymu-a-navy.vercel.app").replace(/\/$/, "");
  const secret = process.env.APP_FEEDBACK_RELAY_SECRET;
  if (!secret) throw new Error("APP_FEEDBACK_RELAY_SECRET is not set, so YMU-A's classes can't be read.");
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  if (since) params.set("since", since);
  const res = await fetch(`${base}/api/class-feed?${params}`, {
    headers: { "x-ymu-apps-secret": secret },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as (FeedPage & { error?: string }) | null;
  if (!res.ok || !body?.events) throw new Error(`YMU-A class feed: ${body?.error ?? `HTTP ${res.status}`}`);
  return body;
}

/** Every page from `since` on; stops if the cursor ever stops advancing. */
async function fetchAll(from: Date, to: Date, since: string | null) {
  const events: FeedEvent[] = [];
  let cursor = since;
  for (let i = 0; i < 10; i++) {
    const page = await fetchFeed(from, to, cursor);
    events.push(...page.events);
    const advanced = page.cursor !== cursor;
    cursor = page.cursor;
    if (!page.hasMore || !advanced) break;
  }
  return { events, cursor };
}

/**
 * Pull YMU-A's class changes into ClassSession. `force` skips the throttle
 * (the Refresh button, the cron). Never throws for a throttled call.
 */
export async function pullClassesFromYmua(
  prisma: PrismaClient,
  options: { force?: boolean; full?: boolean } = {},
): Promise<PullResult> {
  const state = await prisma.syncState.findUnique({ where: { key: FEED_KEY } });
  const now = new Date();
  if (!options.force && state?.lastRunAt && now.getTime() - state.lastRunAt.getTime() < THROTTLE_MS) {
    return { skipped: true, lastRunAt: state.lastRunAt.toISOString() };
  }
  // Claimed before the fetch, so ten people opening the planner at once make
  // one call between them, not ten.
  await prisma.syncState.upsert({
    where: { key: FEED_KEY },
    create: { key: FEED_KEY, lastRunAt: now },
    update: { lastRunAt: now },
  });

  const { start, end } = getDefaultSyncRange();
  // `full` (the nightly cron) reads the whole window again instead of only
  // what changed. A class whose school SVP didn't have yet is ignored, but the
  // cursor still moves past it, so without this a school the roster import
  // adds tonight would get its classes only as each one is next edited.
  const since = options.full ? null : (state?.cursor ?? null);

  // Changes since the cursor, across the whole window...
  const changed = await fetchAll(start, end, since);
  // ...plus, in full, any week that has entered the window since the last run
  // — its classes may not have changed, so a cursor alone would never see them.
  const previousEnd = state?.windowEnd ?? null;
  const fresh = since && previousEnd && previousEnd < end ? await fetchAll(previousEnd, end, null) : { events: [] };
  const events = [...changed.events, ...fresh.events];

  const result = await applyEvents(prisma, events);

  await prisma.syncState.update({
    where: { key: FEED_KEY },
    data: {
      // A full read's cursor is the newest change inside the window; never
      // move back past one already seen outside it.
      cursor: [changed.cursor ?? since, state?.cursor ?? null].filter(Boolean).sort().at(-1) ?? null,
      windowEnd: end,
      lastResult: JSON.stringify(result),
    },
  });
  return { skipped: false, ...result };
}

async function applyEvents(prisma: PrismaClient, events: FeedEvent[]) {
  const counts = { created: 0, updated: 0, removed: 0, unchanged: 0, ignored: 0 };
  if (events.length === 0) return counts;

  // The latest version of each class wins (a page can carry a row twice).
  const byKey = new Map<string, FeedEvent>();
  for (const e of events) {
    if (!e.calendar_id || !e.google_event_id) continue;
    byKey.set(`${e.calendar_id}|${e.google_event_id}`, e);
  }

  const [schools, teachers, subjects, existing] = await Promise.all([
    prisma.school.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true } }),
    prisma.teacher.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true } }),
    prisma.subject.findMany({ select: { id: true, name: true } }),
    prisma.classSession.findMany({
      where: { googleEventId: { in: [...byKey.values()].map((e) => e.google_event_id!) } },
      select: { id: true, googleCalendarId: true, googleEventId: true, schoolId: true, teacherId: true, subjectId: true, startDateTime: true, endDateTime: true },
    }),
  ]);
  const schoolByExternal = new Map(schools.map((s) => [s.externalId!, s.id]));
  const teacherByExternal = new Map(teachers.map((t) => [t.externalId!, t.id]));
  const subjectByName = new Map(subjects.map((s) => [s.name, s.id]));
  const sessionByKey = new Map(existing.map((s) => [`${s.googleCalendarId}|${s.googleEventId}`, s]));

  const subjectFor = async (summary: string | null) => {
    const name = (summary ?? "").trim() || "Unnamed";
    const found = subjectByName.get(name);
    if (found) return found;
    const created = await prisma.subject.upsert({ where: { name }, create: { name }, update: {} });
    subjectByName.set(name, created.id);
    return created.id;
  };
  // A teacher YMU-A knows and SVP doesn't yet: created with their YMU-A id,
  // the same identity scripts/import-teachers-from-ymua.ts uses.
  const teacherFor = async (event: FeedEvent, schoolId: string) => {
    const first = event.teachers[0];
    if (!first) return null;
    const found = teacherByExternal.get(first.id);
    if (found) return found;
    const created = await prisma.teacher.upsert({
      where: { externalId: first.id },
      create: { externalId: first.id, name: first.name || "Unnamed teacher", schoolId },
      update: {},
    });
    teacherByExternal.set(first.id, created.id);
    return created.id;
  };

  const toDelete: string[] = [];
  for (const [key, e] of byKey) {
    const current = sessionByKey.get(key);
    const schoolId = e.school_id ? schoolByExternal.get(e.school_id) : undefined;
    const gone = e.status === "cancelled" || e.all_day || !e.start_at || !e.end_at || !schoolId;
    if (gone) {
      if (current) toDelete.push(current.id);
      else counts.ignored += 1;
      continue;
    }
    const start = new Date(e.start_at!);
    const end = new Date(e.end_at!);
    const subjectId = await subjectFor(e.summary);
    // YMU-A names the teacher by login email, which beats the calendar's
    // organizer the Google sync guessed from. A class YMU-A has no teacher
    // for keeps the one SVP already had rather than losing it.
    const teacherId = (await teacherFor(e, schoolId)) ?? current?.teacherId ?? null;
    if (!current) {
      await prisma.classSession.create({
        data: {
          schoolId,
          subjectId,
          teacherId,
          startDateTime: start,
          endDateTime: end,
          googleCalendarId: e.calendar_id!,
          googleEventId: e.google_event_id!,
        },
      });
      counts.created += 1;
      continue;
    }
    const same =
      current.schoolId === schoolId &&
      current.subjectId === subjectId &&
      current.teacherId === teacherId &&
      current.startDateTime.getTime() === start.getTime() &&
      current.endDateTime.getTime() === end.getTime();
    if (same) {
      counts.unchanged += 1;
      continue;
    }
    await prisma.classSession.update({
      where: { id: current.id },
      data: { schoolId, subjectId, teacherId, startDateTime: start, endDateTime: end },
    });
    counts.updated += 1;
  }

  for (let i = 0; i < toDelete.length; i += 500) {
    const res = await prisma.classSession.deleteMany({ where: { id: { in: toDelete.slice(i, i + 500) } } });
    counts.removed += res.count;
  }
  return counts;
}
