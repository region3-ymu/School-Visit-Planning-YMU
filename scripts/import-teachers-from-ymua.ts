/**
 * Import real teachers from YMU-A and attach them to the classes they teach.
 *
 * The calendar sync names a Teacher after the calendar it found an event on, and
 * YMU's calendars are named after schools — so this app's teacher list is mostly
 * school names ("Brownsville Middle School"), while the few real people in it
 * carry no classes. Observing a teacher was therefore recorded against a row
 * that isn't a person.
 *
 * YMU-A already knows who teaches each class: its calendar_events carry
 * teacher_ids matched by login email. Its events and ours share Google's event
 * id, which lines them up at ~99.6%, so the real teacher can be attached to each
 * session without guessing from names.
 *
 * Usage:
 *   npx tsx scripts/import-teachers-from-ymua.ts            # dry run, writes a CSV
 *   npx tsx scripts/import-teachers-from-ymua.ts --apply     # write it
 *
 * Two phases like the school importer, and for the same reason: teacher identity
 * is easy to get wrong and observations already hang off these rows.
 *
 * Nothing is deleted. Calendar-invented teachers that end up with no classes are
 * listed as orphaned so they can be removed deliberately, not swept up here.
 *
 * Env: YMUA_SUPABASE_URL, YMUA_SUPABASE_SERVICE_ROLE_KEY
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.YMUA_SUPABASE_URL;
const SUPABASE_KEY = process.env.YMUA_SUPABASE_SERVICE_ROLE_KEY;
const PAGE = 1000;
const REVIEW_FILE = "ymua-teacher-import-review.csv";

/**
 * Only the current school year is filled in beyond what YMU-A states.
 *
 * Last year's sessions are still in the database and their events mostly carry
 * no teacher — that isn't a gap to be repaired, it is simply how far back the
 * teacher matching goes. Guessing at them writes a name onto a class somebody
 * else may well have taught. Taken from the earliest quarter on record, so it
 * follows the calendar rather than a date baked in here.
 */
async function currentYearStart(): Promise<Date> {
  const q = await prisma.quarter.findFirst({ orderBy: { startDate: "asc" } });
  if (!q) throw new Error("No quarters seeded — run scripts/seed-quarters.ts first");
  return q.startDate;
}

type Profile = { id: string; full_name: string; role: string; subjects: string[] | null; archived_at: string | null };
type Event = { google_event_id: string; teacher_ids: string[] | null };

async function fetchAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, {
      headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`YMU-A ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("YMUA_SUPABASE_URL and YMUA_SUPABASE_SERVICE_ROLE_KEY are required");
  }

  console.log(apply ? "APPLY — this writes to the database\n" : "DRY RUN — nothing is written\n");

  const profiles = await fetchAll<Profile>("profiles?select=id,full_name,role,subjects,archived_at");
  const events = await fetchAll<Event>("calendar_events?select=google_event_id,teacher_ids");
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const teacherIdsByEvent = new Map(events.map((e) => [e.google_event_id, e.teacher_ids ?? []]));
  console.log(`YMU-A: ${profiles.length} profiles, ${events.length} calendar events`);

  const yearStart = await currentYearStart();
  const sessions = await prisma.classSession.findMany({
    select: { id: true, googleEventId: true, schoolId: true, teacherId: true, startDateTime: true },
  });
  const thisYear = sessions.filter((s) => s.startDateTime >= yearStart);
  console.log(`Local: ${sessions.length} class sessions (${thisYear.length} since ${yearStart.toISOString().slice(0, 10)})\n`);

  // Which YMU-A teacher owns each local session, and which schools each teaches at.
  const assignment = new Map<string, string>(); // sessionId -> profileId
  const schoolsByProfile = new Map<string, Map<string, number>>();
  let unmatchedEvent = 0;
  let noTeacher = 0;

  for (const s of sessions) {
    const ids = teacherIdsByEvent.get(s.googleEventId);
    if (ids === undefined) { unmatchedEvent++; continue; }
    // More than one match means a substitute was on the invite too; Google gives
    // no primary/sub distinction, so the first is taken and the rest ignored.
    const profileId = ids.find((id) => profileById.has(id));
    if (!profileId) { noTeacher++; continue; }
    assignment.set(s.id, profileId);
    const perSchool = schoolsByProfile.get(profileId) ?? new Map<string, number>();
    perSchool.set(s.schoolId, (perSchool.get(s.schoolId) ?? 0) + 1);
    schoolsByProfile.set(profileId, perSchool);
  }

  console.log(`Sessions matched to a YMU-A teacher: ${assignment.size}`);
  console.log(`  event not in YMU-A:      ${unmatchedEvent}`);
  console.log(`  event has no teacher:    ${noTeacher}`);
  console.log(`Distinct teachers:         ${schoolsByProfile.size}\n`);

  const schools = await prisma.school.findMany({ select: { id: true, name: true } });
  const schoolName = new Map(schools.map((s) => [s.id, s.name]));

  const rows: string[] = ["Teacher,YMU-A id,Archived,Schools,Sessions,Primary school"];
  const plan: { profileId: string; name: string; subjects: string | null; primarySchoolId: string }[] = [];

  for (const [profileId, perSchool] of schoolsByProfile) {
    const p = profileById.get(profileId)!;
    const total = [...perSchool.values()].reduce((a, b) => a + b, 0);
    // A teacher can work several schools; schoolId is only the busiest one, and
    // the real school relationship is the sessions themselves.
    const primary = [...perSchool.entries()].sort((a, b) => b[1] - a[1])[0][0];
    plan.push({
      profileId,
      name: p.full_name,
      subjects: p.subjects?.length ? p.subjects.join(", ") : null,
      primarySchoolId: primary,
    });
    rows.push([
      csvEscape(p.full_name), profileId, p.archived_at ? "yes" : "no",
      String(perSchool.size), String(total), csvEscape(schoolName.get(primary) ?? "?"),
    ].join(","));
  }

  plan.sort((a, b) => a.name.localeCompare(b.name));
  console.log("Teachers to import:");
  for (const t of plan.slice(0, 15)) {
    const n = schoolsByProfile.get(t.profileId)!;
    console.log(`  ${t.name.padEnd(24)} ${n.size} school${n.size === 1 ? "" : "s"}, ${[...n.values()].reduce((a, b) => a + b, 0)} sessions`);
  }
  if (plan.length > 15) console.log(`  … and ${plan.length - 15} more`);

  fs.writeFileSync(REVIEW_FILE, rows.join("\n") + "\n");
  console.log(`\nPlan written to ${REVIEW_FILE}`);

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write.");
    return;
  }

  let created = 0, updated = 0;
  const localIdByProfile = new Map<string, string>();
  for (const t of plan) {
    const existing = await prisma.teacher.findUnique({ where: { externalId: t.profileId } });
    const data = { name: t.name, subjects: t.subjects, schoolId: t.primarySchoolId, externalId: t.profileId };
    const row = existing
      ? await prisma.teacher.update({ where: { id: existing.id }, data })
      : await prisma.teacher.create({ data });
    existing ? updated++ : created++;
    localIdByProfile.set(t.profileId, row.id);
  }
  console.log(`\nTeachers created: ${created}, updated: ${updated}`);

  let relinked = 0;
  for (const [sessionId, profileId] of assignment) {
    const teacherId = localIdByProfile.get(profileId);
    if (!teacherId) continue;
    await prisma.classSession.update({ where: { id: sessionId }, data: { teacherId } });
    relinked++;
  }
  console.log(`Class sessions relinked: ${relinked}`);

  // Second pass: fill the gaps within a recurring class, this year only.
  //
  // A handful of instances in a series can come through without a teacher even
  // when the rest of the series names one. Where a (school, subject) group
  // already has a real teacher on some of its sessions this year, the rest of
  // that group is the same weekly class.
  //
  // Bounded to the current year deliberately. Last year's events largely have no
  // teacher at all, and filling those in from this year's roster asserts that
  // whoever teaches a class now also taught it then — which nothing here knows.
  const groups = await prisma.classSession.groupBy({
    by: ["schoolId", "subjectId"],
    where: { startDateTime: { gte: yearStart } },
    _count: { id: true },
  });
  let inferred = 0;
  for (const g of groups) {
    const known = await prisma.classSession.findFirst({
      where: {
        schoolId: g.schoolId,
        subjectId: g.subjectId,
        startDateTime: { gte: yearStart },
        teacher: { externalId: { not: null } },
      },
      select: { teacherId: true },
    });
    if (!known?.teacherId) continue;
    const res = await prisma.classSession.updateMany({
      where: {
        schoolId: g.schoolId,
        subjectId: g.subjectId,
        startDateTime: { gte: yearStart },
        OR: [{ teacherId: null }, { teacher: { externalId: null } }],
      },
      data: { teacherId: known.teacherId },
    });
    inferred += res.count;
  }
  console.log(`Sessions filled in from the rest of their recurring class: ${inferred}`);

  // Undo any earlier over-reach: before the cutoff, a session says exactly what
  // YMU-A says and nothing more.
  const stale = await prisma.classSession.findMany({
    where: { startDateTime: { lt: yearStart }, teacher: { externalId: { not: null } } },
    select: { id: true, googleEventId: true },
  });
  let cleared = 0;
  for (const s of stale) {
    const ids = teacherIdsByEvent.get(s.googleEventId) ?? [];
    if (ids.some((id) => profileById.has(id))) continue;
    await prisma.classSession.update({ where: { id: s.id }, data: { teacherId: null } });
    cleared++;
  }
  if (cleared > 0) console.log(`Last year's sessions cleared back to what YMU-A states: ${cleared}`);

  const stillUnknown = await prisma.classSession.groupBy({
    by: ["schoolId", "subjectId"],
    where: {
      startDateTime: { gte: yearStart },
      OR: [{ teacherId: null }, { teacher: { externalId: null } }],
    },
    _count: { id: true },
  });
  if (stillUnknown.length > 0) {
    console.log(`\nThis year's classes with no teacher anywhere in their series — needs a person named in YMU-A:`);
    for (const u of stillUnknown) {
      const [sc, su] = await Promise.all([
        prisma.school.findUnique({ where: { id: u.schoolId }, select: { name: true } }),
        prisma.subject.findUnique({ where: { id: u.subjectId }, select: { name: true } }),
      ]);
      console.log(`  ${(sc?.name ?? "?").padEnd(36)} ${(su?.name ?? "?").padEnd(24)} ${u._count.id}`);
    }
  }

  const orphans = await prisma.teacher.findMany({
    where: { externalId: null, classSessions: { none: {} } },
    select: { id: true, name: true },
  });
  console.log(`\nCalendar-invented teachers now carrying no classes: ${orphans.length}`);
  for (const o of orphans.slice(0, 10)) console.log(`  ${o.name}`);
  if (orphans.length > 10) console.log(`  … and ${orphans.length - 10} more`);
  console.log("Left in place — deleting a teacher is a deliberate act, not a side effect of an import.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
