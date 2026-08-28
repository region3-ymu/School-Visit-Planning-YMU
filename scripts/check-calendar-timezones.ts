/**
 * What time zone is each school's Google Calendar set to?
 *
 *   npm run check:timezones
 *
 * Google reports an event's dateTime in the CALENDAR's own zone. A calendar set
 * to America/New_York answers "2026-08-28T13:40:00-04:00"; one left on UTC
 * answers "2026-08-28T16:51:00Z" for the very same moment.
 *
 * IMPORTANT, because it is easy to get this backwards and "fix" working data:
 * a UTC calendar does NOT mean the times are wrong. The instant is preserved
 * either way, and both SVP and YMU-A independently render the two UTC-set
 * calendars at identical Miami times (verified 2026-08-28). This is a latent
 * hazard, not a live bug — an event written to that calendar BY API without an
 * explicit timeZone would be taken as UTC and land four hours out, and nobody
 * would notice until a Regional Manager drove to the wrong class.
 *
 * So: worth putting right, not worth panicking about. Read-only; the fix is in
 * the calendar's own settings, not in this app.
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { getGoogleAccessToken, parseServiceAccount } from "../src/lib/google/calendar";

dotenv.config();
dotenv.config({ path: ".env.local" });
const prisma = new PrismaClient();

const EXPECTED = "America/New_York";

async function main() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!encoded) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_BASE64");
  const sa = parseServiceAccount(encoded);
  const token = await getGoogleAccessToken(sa, "https://www.googleapis.com/auth/calendar.readonly");

  const schools = await prisma.school.findMany({
    where: { googleCalendarId: { not: null } },
    select: { name: true, googleCalendarId: true, region: { select: { code: true } } },
    orderBy: { name: "asc" },
  });

  const wrong: { name: string; region: string; zone: string; sessions: number }[] = [];
  let checked = 0;
  let unreadable = 0;

  for (const s of schools) {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(s.googleCalendarId!)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) {
      unreadable += 1;
      console.log(`  ? ${s.name}: could not read (${r.status})`);
      continue;
    }
    const cal = (await r.json()) as { timeZone?: string };
    checked += 1;
    if (cal.timeZone !== EXPECTED) {
      const sessions = await prisma.classSession.count({
        where: { school: { googleCalendarId: s.googleCalendarId } },
      });
      wrong.push({ name: s.name, region: s.region?.code ?? "-", zone: cal.timeZone ?? "(none)", sessions });
    }
  }

  console.log(`\nchecked ${checked} calendars${unreadable ? `, ${unreadable} unreadable` : ""}`);
  console.log(`set to ${EXPECTED}: ${checked - wrong.length}`);
  console.log(`NOT on ${EXPECTED}: ${wrong.length}`);
  for (const w of wrong) {
    console.log(`  ! [${w.region}] ${w.name} — ${w.zone} — ${w.sessions} class sessions affected`);
  }
  if (wrong.length) {
    console.log(
      `\nThese are not necessarily showing wrong times — the stored instant is\n` +
        `correct either way. It is a hazard: an event written to one of these by\n` +
        `API with no explicit timeZone would be read as UTC and land four hours\n` +
        `out. Fix in Google Calendar → that calendar's Settings → Time zone →\n` +
        `${EXPECTED}. Nothing in this app needs to change.`
    );
  }
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
