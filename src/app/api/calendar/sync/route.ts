import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncAllSchoolCalendars, getDefaultSyncRange } from "@/modules/calendarSync";
import { canAdministerApp } from "@/lib/permissions";

/**
 * Manual calendar sync trigger. ADMIN-only via session; also reachable with
 * the shared CRON_SECRET so it can double as the cron entry point if needed.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const session = await auth();
    if (!session?.user || !canAdministerApp(session.user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const { start, end } = getDefaultSyncRange();
    const result = await syncAllSchoolCalendars(prisma, start, end);
    return NextResponse.json(result);
  } catch (err) {
    console.error("calendar sync error:", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
