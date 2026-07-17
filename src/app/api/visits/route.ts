import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const schoolId = body?.schoolId as string | undefined;
    const teacherId = body?.teacherId as string | undefined;
    const start = body?.start as string | undefined;
    const end = body?.end as string | undefined;
    const subject = body?.subject as string | undefined;

    if (!schoolId || !teacherId || !start || !end) {
      return NextResponse.json(
        { error: "Missing required fields: schoolId, teacherId, start, end" },
        { status: 400 }
      );
    }

    const plannedStart = new Date(start);
    const plannedEnd = new Date(end);
    if (Number.isNaN(plannedStart.getTime()) || Number.isNaN(plannedEnd.getTime())) {
      return NextResponse.json(
        { error: "Invalid start/end (use ISO 8601)" },
        { status: 400 }
      );
    }

    const visit = await prisma.visit.create({
      data: {
        schoolId,
        plannedStartDateTime: plannedStart,
        plannedEndDateTime: plannedEnd,
        status: "PLANNED",
        reason: `SUBSTITUTE:${teacherId}${subject ? ` subject=${subject}` : ""}`,
      },
    });

    return NextResponse.json({ ok: true, visitId: visit.id });
  } catch (err) {
    console.error("visits API error:", err);
    return NextResponse.json({ error: "Failed to create visit" }, { status: 500 });
  }
}

