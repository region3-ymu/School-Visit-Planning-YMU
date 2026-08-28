import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { addDaysToDayKey, zonedDayStart } from "@/lib/timezone";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const schoolId = searchParams.get("schoolId");
  const date = searchParams.get("date"); // yyyy-MM-dd (local)

  if (!schoolId || !date) {
    return NextResponse.json(
      { error: "Missing required query: schoolId, date" },
      { status: 400 }
    );
  }

  // Miami's day, not the runtime's. A bare "2026-08-28T00:00:00" is parsed in
  // whatever zone the process happens to be in — on Vercel that is UTC, so this
  // window ran 8pm the previous evening to 8pm the requested day, returning the
  // wrong classes for the date it was asked about.
  const dayStart = zonedDayStart(date);
  const dayEnd = new Date(zonedDayStart(addDaysToDayKey(date, 1)).getTime() - 1);
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const sessions = await prisma.classSession.findMany({
    where: {
      schoolId,
      startDateTime: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { startDateTime: "asc" },
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(
    sessions.map((s) => ({
      id: s.id,
      startDateTime: s.startDateTime.toISOString(),
      endDateTime: s.endDateTime.toISOString(),
      subjectId: s.subjectId,
      subjectName: s.subject.name,
      teacherId: s.teacherId,
      teacherName: s.teacher?.name ?? null,
    }))
  );
}

