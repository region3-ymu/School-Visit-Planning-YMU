import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncDatasetToSheet } from "@/lib/export/syncSheet";

/**
 * Vercel Cron entry point (once daily, 30 minutes after the calendar sync so
 * the sheet reflects the day's freshly-synced classes — see vercel.json).
 * Same auth as /api/cron/sync-calendars: Vercel sends
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
    const result = await syncDatasetToSheet(prisma);
    return NextResponse.json(result);
  } catch (err) {
    console.error("cron sheet sync error:", err);
    const message = err instanceof Error ? err.message : "Sheet sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
