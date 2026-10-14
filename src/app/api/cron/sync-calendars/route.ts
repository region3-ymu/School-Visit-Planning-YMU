import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAllSchoolCalendars, getDefaultSyncRange } from "@/modules/calendarSync";
import { applyYmuaImport, fetchYmuaRoster, planYmuaImport } from "@/lib/ymuaImport";

/**
 * Vercel Cron entry point (once daily at 11:00 UTC, see vercel.json — the
 * Vercel Hobby plan only allows one run/day). Vercel includes
 * `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set
 * as a project env var — verify it here since cron requests have no session.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // First, the school roster from YMU-A (#50): a school created there today
  // exists here tomorrow without anyone running scripts/import-from-ymua.ts.
  // Before the calendar sync, so a new school's calendar is synced in the
  // same run. A failure here is reported but never stops the calendar sync.
  let roster: { created: number; updated: number; failures: string[] } | { error: string };
  try {
    const plan = await planYmuaImport(prisma, await fetchYmuaRoster());
    roster = await applyYmuaImport(prisma, plan);
  } catch (err) {
    console.error("cron YMU-A roster import error:", err);
    roster = { error: err instanceof Error ? err.message : "Roster import failed" };
  }

  try {
    const { start, end } = getDefaultSyncRange();
    const result = await syncAllSchoolCalendars(prisma, start, end);
    return NextResponse.json({ ...result, roster });
  } catch (err) {
    console.error("cron calendar sync error:", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
