import { PrismaClient } from "@prisma/client";
import { startOfDay, endOfDay } from "date-fns";

/**
 * Find teachers who have no ClassSession overlapping the given time range
 * in any school. Prefer same school; optionally order by fewer sessions that day.
 */
export async function findAvailableSubstitutes(
  prisma: PrismaClient,
  schoolId: string,
  startDateTime: Date,
  endDateTime: Date,
  subjectQuery?: string,
  excludeTeacherId?: string
): Promise<import("./types").ScoredSubstituteCandidate[]> {
  const subjectQ = (subjectQuery ?? "").trim();
  const teachers = await prisma.teacher.findMany({
    include: {
      school: { select: { id: true, name: true } },
      classSessions: {
        where: {
          startDateTime: { lt: endDateTime },
          endDateTime: { gt: startDateTime },
        },
      },
    },
  });

  const dayStart = startOfDay(startDateTime);
  const dayEnd = endOfDay(startDateTime);
  const sessionsCountByTeacher = await prisma.classSession.groupBy({
    by: ["teacherId"],
    where: {
      teacherId: { not: null },
      startDateTime: { gte: dayStart },
      endDateTime: { lte: dayEnd },
    },
    _count: { id: true },
  });
  const countMap = new Map<string, number>();
  for (const g of sessionsCountByTeacher) {
    if (g.teacherId) countMap.set(g.teacherId, g._count.id);
  }

  const available: import("./types").ScoredSubstituteCandidate[] = [];
  for (const t of teachers) {
    if (excludeTeacherId && t.id === excludeTeacherId) continue;
    if (t.classSessions.length > 0) continue;
    const sameSchool = t.schoolId === schoolId;
    const sessionsThatDay = countMap.get(t.id) ?? 0;
    const subjectsText = t.subjects ?? null;
    const subjectsMatch = subjectQ
      ? (subjectsText ?? "")
          .split(/\r?\n|,/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .some((s) => s === subjectQ.toLowerCase() || s.includes(subjectQ.toLowerCase()))
      : false;
    const freeExact = true;
    const score =
      (freeExact ? 100 : 0) +
      (sameSchool ? 50 : 0) +
      (subjectsMatch ? 30 : 0);

    available.push({
      teacherId: t.id,
      teacherName: t.name,
      email: t.email,
      schoolId: t.schoolId,
      schoolName: t.school?.name ?? null,
      sameSchool,
      sessionsThatDay,
      freeExact,
      subjectsMatch,
      score,
      availableStart: startDateTime.toISOString(),
      availableEnd: endDateTime.toISOString(),
      subjects: subjectsText,
    });
  }

  available.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // tiebreakers: same school, then fewer sessions
    if (a.sameSchool !== b.sameSchool) return a.sameSchool ? -1 : 1;
    return a.sessionsThatDay - b.sessionsThatDay;
  });

  return available;
}
