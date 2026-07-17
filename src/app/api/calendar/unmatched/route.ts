import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Review queue: Google calendars pulled during sync with no matching active School. */
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const issues = await prisma.calendarSyncIssue.findMany({
    where: { resolvedAt: null },
    orderBy: { detectedAt: "desc" },
  });
  return NextResponse.json(issues);
}
