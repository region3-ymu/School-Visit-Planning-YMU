/**
 * Is every region as usable as Central?
 *
 *   npm run check:regions
 *
 * Central was built and tested with a real Regional Manager sitting in it; the
 * other four were not, and "it works for me" is not evidence about them. This
 * walks each region through everything a Regional Manager depends on — a
 * manager on the account, schools with addresses and coordinates, calendars
 * connected and recently synced, classes this week, and a weekly plan that
 * actually proposes something — and prints what is missing rather than a
 * pass/fail nobody can act on.
 *
 * Read-only.
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { proposeVisitsForWeek } from "../src/modules/visitPlanner";
import { programmeScopeFor, workWindowFor } from "../src/lib/permissions";
import { dayKeyInAppZone, mondayOfDayKey, zonedDayStart, addDaysToDayKey } from "../src/lib/timezone";

dotenv.config();
const prisma = new PrismaClient();

const MIAMI_BOUNDS = { minLat: 25.1, maxLat: 26.0, minLng: -80.9, maxLng: -80.05 };
const STALE_SYNC_DAYS = 2;

async function main() {
  const todayKey = dayKeyInAppZone(new Date());
  const weekStart = zonedDayStart(mondayOfDayKey(todayKey));
  const weekEnd = zonedDayStart(addDaysToDayKey(mondayOfDayKey(todayKey), 5));
  console.log(`week of ${mondayOfDayKey(todayKey)} (Miami)\n`);

  const regions = await prisma.region.findMany({
    select: { id: true, code: true, manager: { select: { email: true, name: true } } },
    orderBy: { code: "asc" },
  });

  const problems: string[] = [];

  for (const region of regions) {
    const schools = await prisma.school.findMany({
      where: { regionId: region.id, active: true, isOffice: false },
      select: {
        id: true, name: true, address: true, lat: true, lng: true,
        googleCalendarId: true, calendarLastSyncedAt: true, calendarSyncToken: true,
      },
    });

    const noAddress = schools.filter((s) => !s.address?.trim());
    const noCoords = schools.filter((s) => s.lat == null || s.lng == null);
    const outOfBounds = schools.filter(
      (s) => s.lat != null && s.lng != null &&
        (s.lat < MIAMI_BOUNDS.minLat || s.lat > MIAMI_BOUNDS.maxLat ||
         s.lng < MIAMI_BOUNDS.minLng || s.lng > MIAMI_BOUNDS.maxLng)
    );
    const noCalendar = schools.filter((s) => !s.googleCalendarId);
    const neverSynced = schools.filter((s) => s.calendarLastSyncedAt == null);
    const syncedAt = schools
      .map((s) => s.calendarLastSyncedAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime());
    const newestSync = syncedAt[0] ?? null;
    const syncAgeDays = newestSync
      ? Math.floor((Date.now() - newestSync.getTime()) / 86_400_000)
      : null;

    const sessionsThisWeek = await prisma.classSession.count({
      where: { school: { regionId: region.id }, startDateTime: { gte: weekStart, lt: weekEnd } },
    });
    const schoolsTeachingThisWeek = await prisma.classSession.findMany({
      where: { school: { regionId: region.id }, startDateTime: { gte: weekStart, lt: weekEnd } },
      select: { schoolId: true },
      distinct: ["schoolId"],
    });

    const visits = await prisma.visit.count({
      where: { status: "DONE", school: { regionId: region.id } },
    });

    // The same call the app makes for that region's manager.
    let planned = 0;
    let planError: string | null = null;
    try {
      const plan = await proposeVisitsForWeek(prisma, weekStart, {
        regionId: region.id,
        programmes: programmeScopeFor("REGIONAL_MANAGER"),
        workWindow: workWindowFor("REGIONAL_MANAGER"),
        maxVisitsPerWeek: 12,
        maxVisitsPerDay: 4,
      });
      planned = plan.length;
    } catch (err) {
      planError = err instanceof Error ? err.message : String(err);
    }

    console.log(`${region.code}`);
    console.log(`  manager: ${region.manager ? `${region.manager.name ?? "(no name)"} <${region.manager.email}>` : "NONE ASSIGNED"}`);
    console.log(`  schools: ${schools.length} · no address: ${noAddress.length} · no coords: ${noCoords.length} · outside Miami-Dade: ${outOfBounds.length}`);
    console.log(`  calendars: ${schools.length - noCalendar.length}/${schools.length} connected · never synced: ${neverSynced.length} · newest sync: ${newestSync ? `${newestSync.toISOString().slice(0, 10)} (${syncAgeDays}d ago)` : "never"}`);
    console.log(`  classes this week: ${sessionsThisWeek} across ${schoolsTeachingThisWeek.length} schools`);
    console.log(`  visits recorded (all time): ${visits}`);
    console.log(`  weekly plan proposes: ${planError ? `ERROR — ${planError}` : `${planned} visits`}`);
    console.log();

    if (!region.manager) problems.push(`${region.code}: no regional manager assigned`);
    if (noAddress.length) problems.push(`${region.code}: ${noAddress.length} school(s) with no address`);
    if (noCoords.length) problems.push(`${region.code}: ${noCoords.length} school(s) with no coordinates — routing and geofence will fail`);
    if (outOfBounds.length) problems.push(`${region.code}: ${outOfBounds.length} school(s) geocoded outside Miami-Dade`);
    if (noCalendar.length) problems.push(`${region.code}: ${noCalendar.length} school(s) with no Google calendar`);
    if (syncAgeDays != null && syncAgeDays > STALE_SYNC_DAYS) {
      problems.push(`${region.code}: calendars last synced ${syncAgeDays} days ago — new or moved classes are not in the app`);
    }
    if (planError) problems.push(`${region.code}: weekly plan failed — ${planError}`);
    else if (planned === 0 && sessionsThisWeek > 0) {
      problems.push(`${region.code}: has classes this week but the plan proposes nothing`);
    }
  }

  const afterschool = await proposeVisitsForWeek(prisma, weekStart, {
    programmes: programmeScopeFor("AFTER_SCHOOL_MANAGER"),
    workWindow: workWindowFor("AFTER_SCHOOL_MANAGER"),
    maxVisitsPerWeek: 12,
    maxVisitsPerDay: 4,
  });
  console.log(`AFTERSCHOOL (all regions): plan proposes ${afterschool.length} visits`);
  afterschool.forEach((v) =>
    console.log(`  ${v.date.toISOString().slice(0, 10)} ${v.startTime} ${v.schoolName} — ${v.subjectName ?? "(no class)"}`)
  );

  console.log(`\n${problems.length ? `${problems.length} problem(s):` : "No problems found."}`);
  problems.forEach((p) => console.log(`  ! ${p}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
