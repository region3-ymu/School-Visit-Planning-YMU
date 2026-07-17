import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAllSchoolCalendars, getDefaultSyncRange } from "@/modules/calendarSync";

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

  try {
    const { start, end } = getDefaultSyncRange();
    const result = await syncAllSchoolCalendars(prisma, start, end);
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron calendar sync error:", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
