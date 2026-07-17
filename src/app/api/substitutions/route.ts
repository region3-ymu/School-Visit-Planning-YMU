import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { findAvailableSubstitutes } from "@/modules/substitutions";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const schoolId = searchParams.get("schoolId");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const subject = searchParams.get("subject") ?? undefined;
  const excludeTeacherId = searchParams.get("excludeTeacherId") ?? undefined;

  if (!schoolId || !start || !end) {
    return NextResponse.json(
      { error: "Missing required query: schoolId, start, end" },
      { status: 400 }
    );
  }

  const startDateTime = new Date(start);
  const endDateTime = new Date(end);
  if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
    return NextResponse.json(
      { error: "Invalid start or end date (use ISO 8601)" },
      { status: 400 }
    );
  }

  try {
    const candidates = await findAvailableSubstitutes(
      prisma,
      schoolId,
      startDateTime,
      endDateTime,
      subject,
      excludeTeacherId
    );
    return NextResponse.json(candidates);
  } catch (err) {
    console.error("substitutions API error:", err);
    return NextResponse.json(
      { error: "Failed to find substitutes" },
      { status: 500 }
    );
  }
}
