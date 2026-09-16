/**
 * Fill in the programme, and the observed teacher, on visits recorded before
 * the app captured them.
 *
 *   npx tsx scripts/backfill-visit-observations.ts            # dry run
 *   npx tsx scripts/backfill-visit-observations.ts --apply     # write it
 *
 * Visit.observedTeacherId arrived in 20260829 and Visit.observedSubjectId in
 * 20260916; both migrations deliberately left every existing row null, because
 * a name or a programme inferred at import time is indistinguishable afterwards
 * from one the RM actually recorded. This is that inference, run deliberately
 * and on its own, which is the only way it should ever happen.
 *
 * THE RULE IS THE DAY, NOT THE HOUR. It is tempting to match a visit to the
 * class that was running at plannedStartDateTime, and it would be wrong:
 * plannedStartDateTime is not when the class was, it is the visit's POSITION IN
 * THE ROUTE — nextSlotForDay() hands out 8am, 9am, 10am in confirm order, so
 * the first stop of every day reads 08:00 whatever time the RM actually stood
 * in the room. Matching on it produces overlaps that look like evidence and are
 * coincidence: it "confirms" 29 teachers where the honest rule finds far fewer.
 *
 * So: the school, on that Miami day. One programme taught there that day leaves
 * nothing to guess and the visit saw it. Two and this script writes nothing,
 * because picking one would be this script's guess wearing the RM's signature.
 *
 * Scoped the way the app scopes itself, so a backfilled row is indistinguishable
 * from one recorded today rather than merely similar:
 *   - programme:  every in-person DONE visit — confirmVisit() sets it whether or
 *                 not a rubric was filled, because which programme was running
 *                 is a fact about the visit and not about the paperwork.
 *   - teacher:    only visits carrying observation content (a rating, notes, or
 *                 "visited with a YMU teacher") — confirmVisit() only sets it
 *                 alongside a rubric, and a teacher stamped on a visit that
 *                 rated nobody would invent an observation that never happened.
 *
 * Only ever fills a null. Re-running changes nothing, and it cannot overwrite
 * something a person entered by hand.
 *
 * Run scripts/import-teachers-from-ymua.ts FIRST. 4094 of 6293 class sessions
 * carry no teacher locally while YMU-A knows one for 6063 of them, so the
 * teacher half of this script is mostly measuring that gap until the import has
 * closed it.
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { dayKeyInAppZone, zonedDayStart, addDaysToDayKey } from "../src/lib/timezone";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

type Outcome = "filled" | "nothing scheduled" | "ambiguous";

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  console.log(apply ? "APPLY — this writes to the database\n" : "DRY RUN — nothing is written\n");

  const visits = await prisma.visit.findMany({
    where: { status: "DONE", mode: "IN_PERSON" },
    select: {
      id: true, schoolId: true, plannedStartDateTime: true,
      observedSubjectId: true, observedTeacherId: true, visitedWith: true,
      obsPlanningPrep: true, obsCultureManagement: true, obsInstructionMusicianship: true,
      obsEngagementEvidence: true, obsProfessionalismGrowth: true, obsNotes: true,
      obsSkipReason: true,
      school: { select: { name: true } },
    },
    orderBy: { plannedStartDateTime: "asc" },
  });

  const subjectTally: Record<Outcome, number> = { filled: 0, "nothing scheduled": 0, ambiguous: 0 };
  const teacherTally: Record<Outcome, number> = { filled: 0, "nothing scheduled": 0, ambiguous: 0 };
  let teacherCandidates = 0;
  const writes: { id: string; data: { observedSubjectId?: string; observedTeacherId?: string } }[] = [];
  const samples: string[] = [];

  for (const v of visits) {
    const dayKey = dayKeyInAppZone(v.plannedStartDateTime);
    const dayStart = zonedDayStart(dayKey);
    const dayEnd = zonedDayStart(addDaysToDayKey(dayKey, 1));
    const sessions = await prisma.classSession.findMany({
      where: { schoolId: v.schoolId, startDateTime: { gte: dayStart, lt: dayEnd } },
      select: { subjectId: true, teacherId: true,
                subject: { select: { name: true } }, teacher: { select: { name: true } } },
    });

    const data: { observedSubjectId?: string; observedTeacherId?: string } = {};

    if (v.observedSubjectId == null) {
      const subjects = [...new Map(sessions.map((s) => [s.subjectId, s.subject.name])).entries()];
      if (subjects.length === 1) {
        data.observedSubjectId = subjects[0][0];
        subjectTally.filled++;
      } else subjectTally[subjects.length === 0 ? "nothing scheduled" : "ambiguous"]++;
    }

    // "This visit observed somebody" — the same condition the confirm modal
    // uses to show the rubric at all.
    const hasObservation =
      v.visitedWith.includes("YMU_TEACHER") || v.obsSkipReason != null || v.obsNotes != null ||
      v.obsPlanningPrep != null || v.obsCultureManagement != null ||
      v.obsInstructionMusicianship != null || v.obsEngagementEvidence != null ||
      v.obsProfessionalismGrowth != null;

    if (v.observedTeacherId == null && hasObservation) {
      teacherCandidates++;
      const teachers = [...new Map(
        sessions.filter((s) => s.teacherId).map((s) => [s.teacherId!, s.teacher!.name])
      ).entries()];
      if (teachers.length === 1) {
        data.observedTeacherId = teachers[0][0];
        teacherTally.filled++;
      } else teacherTally[teachers.length === 0 ? "nothing scheduled" : "ambiguous"]++;
    }

    if (Object.keys(data).length > 0) {
      writes.push({ id: v.id, data });
      if (samples.length < 12) {
        const subj = sessions.find((s) => s.subjectId === data.observedSubjectId)?.subject.name;
        const teach = sessions.find((s) => s.teacherId === data.observedTeacherId)?.teacher?.name;
        samples.push(
          `  ${dayKey}  ${v.school.name.padEnd(34).slice(0, 34)}` +
          `  programme=${subj ?? "—"}`.padEnd(34) +
          `  teacher=${teach ?? "—"}`
        );
      }
    }
  }

  console.log(`In-person DONE visits considered: ${visits.length}\n`);
  console.log("Programme (every in-person DONE visit missing one):");
  console.log(`  filled                ${subjectTally.filled}`);
  console.log(`  no class that day     ${subjectTally["nothing scheduled"]}`);
  console.log(`  two or more, skipped  ${subjectTally.ambiguous}`);
  console.log(`\nObserved teacher (only the ${teacherCandidates} visits that observed somebody):`);
  console.log(`  filled                ${teacherTally.filled}`);
  console.log(`  no teacher on file    ${teacherTally["nothing scheduled"]}`);
  console.log(`  two or more, skipped  ${teacherTally.ambiguous}`);
  console.log(`\nVisits to update: ${writes.length}`);
  if (samples.length) console.log("\nSample:\n" + samples.join("\n"));

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write.");
    return;
  }

  // One transaction: a half-applied backfill is the worst of both, because the
  // only way to tell which rows it reached is to re-derive it.
  await prisma.$transaction(
    writes.map((w) => prisma.visit.update({ where: { id: w.id }, data: w.data }))
  );
  console.log(`\nWrote ${writes.length} visits.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
