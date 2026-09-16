import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncDatasetToSheet } from "@/lib/export/syncSheet";

/**
 * Vercel Cron entry point (once daily at 23:00 UTC — see vercel.json).
 *
 * That is 7pm Miami in summer and 6pm in winter: after the last visit of the
 * day is logged, and still after the 11:00 UTC calendar sync, so the sheet
 * reflects the day's freshly-synced classes as it always did. It used to run
 * at 11:30 UTC — 7:30am Miami — which meant the export never contained the
 * day it was read on. Somebody checking at lunchtime saw an empty afternoon
 * and reported it as visits not syncing at all.
 *
 * Once a day is still once a day, so syncExportSheet() in actions.ts gives
 * oversight a refresh button for "I need it now".
 *
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
