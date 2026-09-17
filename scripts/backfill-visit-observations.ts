/**
 * Fill in the programme, and the observed teacher, on visits recorded before
 * the app captured them.
 *
 *   npx tsx scripts/backfill-visit-observations.ts             # dry run, all tiers
 *   npx tsx scripts/backfill-visit-observations.ts --apply      # write tiers 1-2
 *   npx tsx scripts/backfill-visit-observations.ts --apply --clock   # …and tier 3
 *
 * THREE TIERS, and they are not equally true. The first two are the database
 * restating what it already holds; the third is an inference, which is why it
 * is behind its own flag and reported on its own line.
 *
 *   1  THE DAY.  One programme, or one teacher, at that school that day. There
 *      is nothing to choose between, so nothing is being decided here.
 *
 *   2  THE CROSS.  The teacher is already recorded and taught exactly one
 *      programme there that day — so the programme follows from a fact the RM
 *      themselves entered. Also the reverse. Still not a guess.
 *
 *   3  THE CLOCK.  createdAt is the moment Confirm was pressed, and when the
 *      visit carries a GPS fix taken on site with no override, that moment is
 *      the RM standing in the building. Measured before trusting it: of 41
 *      such visits at schools with classes that day, 33 (80%) were confirmed
 *      with a class actually running, median 52 minutes in; of the 8 that were
 *      not, 7 landed 6-19 minutes after a class ended — walking out and
 *      pressing the button. Hence the 25-minute grace below. One visit
 *      confirmed 35 minutes early, which is the error rate this tier carries.
 *
 *      It could not be validated the way it should be, against visits where
 *      the RM chose the teacher by hand: all 21 of those fall on days that
 *      were already unambiguous, so they test nothing. Read tier 3 as good
 *      evidence, not as a record.
 *
 *   4  THE CLOCK, WITHOUT GPS (--clock-sameday). Same match, weaker standing:
 *      no location fix, but the paperwork was filed on the day of the visit,
 *      so createdAt is still a clock rather than a memory. The distinction
 *      earns its keep — three of the visits it would otherwise reach were
 *      typed five to twelve days late, two of them ninety seconds apart at a
 *      desk, and there createdAt records the typing and nothing else.
 *
 *      Tier 4 also refuses any school whose timetable contains a Subject named
 *      after a teacher. The calendar sync takes the event title as the
 *      programme, so an event titled "David Maden" is a programme called
 *      "David Maden" — 26 classes of it at Air Base K-8. On a timetable like
 *      that the slot the clock matches may be the mislabelled one, and the
 *      Program column would carry a person's name as though YMU ran it. Rename
 *      the event in Calendar and the school becomes inferable like any other.
 *
 * Visit.observedTeacherId arrived in 20260829 and Visit.observedSubjectId in
 * 20260916; both migrations deliberately left every existing row null, because
 * a name or a programme inferred at import time is indistinguishable afterwards
 * from one the RM actually recorded. This is that inference, run deliberately
 * and on its own, which is the only way it should ever happen.
 *
 * NEVER plannedStartDateTime. It is tempting to match a visit to the class
 * running at plannedStartDateTime, and it would be wrong: that field is not
 * when the class was, it is the visit's POSITION IN THE ROUTE —
 * nextSlotForDay() hands out 8am, 9am, 10am in confirm order, so the first stop
 * of every day reads 08:00 whatever time the RM actually stood in the room.
 * Matching on it produces overlaps that look like evidence and are
 * coincidence: it "confirms" 29 teachers where tier 1 finds 17. createdAt is
 * the timestamp that means something, and only tier 3 uses it.
 *
 * Scoped the way the app scopes itself, so a backfilled row is indistinguishable
 * from one recorded today rather than merely similar:
 *   - programme:  every in-person DONE visit — confirmVisit() sets it whether or
 *                 not a rubric was filled, because which programme was running
 *                 is a fact about the visit and not about the paperwork.
 *   - teacher:    ONLY visits that ticked "YMU teacher" in who they saw — the
 *                 app's own showTeacherObservation. An RM who went to see a
 *                 principal or the main office observed no YMU teacher, and
 *                 that column is meant to stay empty on their visit. Filling
 *                 it would invent an observation that never happened, so the
 *                 blank there is the answer, not a gap.
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

/**
 * How long after a class ends a Confirm still counts as that class.
 *
 * From the data, not from taste: the confirms that missed a class window all
 * landed 6-19 minutes past the end of one. Twenty-five covers that with room
 * and still ends well before the next period starts.
 */
const GRACE_MS = 25 * 60 * 1000;

type Tier = 1 | 2 | 3 | 4;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const clock = args.includes("--clock");
  const clock4 = args.includes("--clock-sameday");
  console.log(apply ? "APPLY — this writes to the database\n" : "DRY RUN — nothing is written\n");

  const visits = await prisma.visit.findMany({
    where: { status: "DONE", mode: "IN_PERSON" },
    select: {
      id: true, schoolId: true, plannedStartDateTime: true, createdAt: true,
      geofenceDistanceM: true, geofenceOverridden: true,
      observedSubjectId: true, observedTeacherId: true, visitedWith: true,
      school: { select: { name: true } },
    },
    orderBy: { plannedStartDateTime: "asc" },
  });

  const subjectBy: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const teacherBy: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  // Programme titles that are really somebody's name. The calendar sync takes
  // the event title as the programme, so an event called "David Maden" becomes
  // a Subject called "David Maden" — 26 classes of it at Air Base K-8. A
  // school whose timetable contains one of these is not a timetable this
  // script will infer anything from: the slot it would match might be the
  // mislabelled one, and "David Maden" written into the Program column reads
  // as a programme YMU runs. Fixed by renaming the event in Calendar, at which
  // point those schools become inferable like any other.
  const teacherNames = new Set(
    (await prisma.teacher.findMany({ select: { name: true } })).map((t) => t.name.toLowerCase())
  );
  const contaminated = new Set(
    (await prisma.subject.findMany({ select: { id: true, name: true } }))
      .filter((sub) => teacherNames.has(sub.name.toLowerCase()))
      .map((sub) => sub.id)
  );
  let subjectOpen = 0, teacherOpen = 0, subjectNoClass = 0, teacherCandidates = 0;
  const writes: { id: string; tier: Tier; data: { observedSubjectId?: string; observedTeacherId?: string } }[] = [];
  const samples: string[] = [];

  for (const v of visits) {
    const dayKey = dayKeyInAppZone(v.plannedStartDateTime);
    const sessions = await prisma.classSession.findMany({
      where: {
        schoolId: v.schoolId,
        startDateTime: { gte: zonedDayStart(dayKey), lt: zonedDayStart(addDaysToDayKey(dayKey, 1)) },
      },
      select: {
        subjectId: true, teacherId: true, startDateTime: true, endDateTime: true,
        subject: { select: { name: true } }, teacher: { select: { name: true } },
      },
    });

    // A GPS fix taken on site, not waved through. Without it createdAt says
    // only when the form was filled in, which could be that evening at home.
    const onSite = v.geofenceDistanceM != null && !v.geofenceOverridden;

    // Tier 4's weaker standing: no GPS, but the paperwork was done on the day
    // of the visit, so the clock is still a clock and not a memory. The
    // difference is real — of the visits this would reach, three were typed up
    // five to twelve days later, two of them ninety seconds apart at a desk,
    // and for those createdAt records the typing and nothing else.
    const sameDay = dayKeyInAppZone(v.createdAt) === dayKey;
    const timetableIsSound = !sessions.some((c) => contaminated.has(c.subjectId));

    const window = (cs: typeof sessions) =>
      cs.filter((c) => +v.createdAt >= +c.startDateTime && +v.createdAt < +c.endDateTime + GRACE_MS);
    const atTheTime = onSite ? window(sessions) : [];
    const atTheTimeWeak =
      !onSite && sameDay && timetableIsSound && clock4 ? window(sessions) : [];

    const only = <T,>(xs: T[]): T | null => (new Set(xs).size === 1 ? xs[0] : null);
    const data: { observedSubjectId?: string; observedTeacherId?: string } = {};
    let tier: Tier | null = null;
    const claim = (t: Tier) => { tier = tier == null || t > tier ? t : tier; };
    // The tier of the programme this pass settled, if it settled one. A teacher
    // reached THROUGH that programme can be no more certain than the programme
    // was: deriving a teacher from a clock-inferred subject and then filing it
    // as tier 2 would smuggle tier 3 past the --clock flag that exists to hold
    // it back.
    let subjectTier: Tier | null = v.observedSubjectId != null ? 1 : null;

    if (v.observedSubjectId == null) {
      const day = only(sessions.map((c) => c.subjectId));
      const cross = v.observedTeacherId
        ? only(sessions.filter((c) => c.teacherId === v.observedTeacherId).map((c) => c.subjectId))
        : null;
      const clock = only(atTheTime.map((c) => c.subjectId));
      const weak = only(atTheTimeWeak.map((c) => c.subjectId));
      const pick = day ?? cross ?? clock ?? weak;
      const from: Tier | null = day ? 1 : cross ? 2 : clock ? 3 : weak ? 4 : null;
      if (pick && from) {
        data.observedSubjectId = pick; subjectBy[from]++; claim(from); subjectTier = from;
      } else if (sessions.length === 0) subjectNoClass++;
      else subjectOpen++;
    }

    // Did this visit observe a YMU teacher at all?
    //
    // Exactly showTeacherObservation from ConfirmVisitModal and VisitHistory —
    // `!isRemote && visitedWith.includes("YMU_TEACHER")`, with isRemote already
    // handled by the IN_PERSON filter on the query. Not the looser "does it
    // carry a rubric": plenty of an RM's visits are to a principal or a main
    // office and observe no YMU teacher, and on those the teacher column is
    // SUPPOSED to be empty. Filling it would invent an observation, and the
    // emptiness is the right answer rather than a gap to close.
    //
    // The two rules agree on today's data — no visit carries a rubric without
    // the box ticked, and none has a teacher without it either — so this is
    // about which rule is written down, not which rows it reaches now.
    const hasObservation = v.visitedWith.includes("YMU_TEACHER");

    if (v.observedTeacherId == null && hasObservation) {
      teacherCandidates++;
      const withTeacher = sessions.filter((c) => c.teacherId);
      const day = only(withTeacher.map((c) => c.teacherId!));
      const known = data.observedSubjectId ?? v.observedSubjectId;
      const cross = known
        ? only(withTeacher.filter((c) => c.subjectId === known).map((c) => c.teacherId!))
        : null;
      const clock = only(atTheTime.filter((c) => c.teacherId).map((c) => c.teacherId!));
      const weak = only(atTheTimeWeak.filter((c) => c.teacherId).map((c) => c.teacherId!));
      const pick = day ?? cross ?? clock ?? weak;
      // A cross-derived teacher inherits the programme's tier when that is the
      // weaker of the two.
      const crossTier: Tier = subjectTier != null && subjectTier > 2 ? subjectTier : 2;
      const from: Tier | null = day ? 1 : cross ? crossTier : clock ? 3 : weak ? 4 : null;
      if (pick && from) { data.observedTeacherId = pick; teacherBy[from]++; claim(from); }
      else teacherOpen++;
    }

    if (tier != null && Object.keys(data).length > 0) {
      writes.push({ id: v.id, tier, data });
      if (tier >= 3 && samples.length < 12) {
        const c = atTheTime[0] ?? atTheTimeWeak[0];
        samples.push(
          `  T${tier}  ${dayKey} conf.${String(v.createdAt.toISOString().slice(11, 16))}Z  ` +
          `${v.school.name.padEnd(30).slice(0, 30)} → ${c!.subject.name}` +
          `${c!.teacher ? " / " + c!.teacher!.name : ""}`
        );
      }
    }
  }

  const t12 = writes.filter((w) => w.tier < 3);
  const t3 = writes.filter((w) => w.tier === 3);
  const t4 = writes.filter((w) => w.tier === 4);

  console.log(`In-person DONE visits considered: ${visits.length}\n`);
  console.log("Programme filled, by tier:");
  console.log(`  1 only one that day           ${subjectBy[1]}`);
  console.log(`  2 follows from the teacher    ${subjectBy[2]}`);
  console.log(`  3 confirmed during the class  ${subjectBy[3]}`);
  console.log(`  4 same day, no GPS            ${subjectBy[4]}`);
  console.log(`  — still open (2+, no signal)  ${subjectOpen}`);
  console.log(`  — no class that day at all    ${subjectNoClass}`);
  console.log(`\nObserved teacher, of the ${teacherCandidates} visits that saw a YMU teacher:`);
  console.log(`  1 only one that day           ${teacherBy[1]}`);
  console.log(`  2 follows from the programme  ${teacherBy[2]}`);
  console.log(`  3 confirmed during the class  ${teacherBy[3]}`);
  console.log(`  4 same day, no GPS            ${teacherBy[4]}`);
  console.log(`  — still open                  ${teacherOpen}`);
  console.log(`\nVisits to update: ${writes.length}  (tiers 1-2: ${t12.length}, tier 3: ${t3.length}, tier 4: ${t4.length})`);
  if (samples.length) console.log("\nClock-derived — confirm time against the class it lands in:\n" + samples.join("\n"));

  if (!apply) {
    console.log("\nDry run only. --apply writes tiers 1-2; add --clock for tier 3.");
    return;
  }

  const chosen = writes.filter((w) => w.tier < 3 || (w.tier === 3 && clock) || (w.tier === 4 && clock4));
  if (!clock && t3.length) {
    console.log(`\nHolding back ${t3.length} tier-3 visits — pass --clock to include them.`);
  }

  // One transaction: a half-applied backfill is the worst of both, because the
  // only way to tell which rows it reached is to re-derive it.
  await prisma.$transaction(
    chosen.map((w) => prisma.visit.update({ where: { id: w.id }, data: w.data }))
  );
  console.log(`\nWrote ${chosen.length} visits.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
