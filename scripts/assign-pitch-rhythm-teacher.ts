/**
 * Put De Anthony Williams on Pitch & Rhythm at Van E. Blanton and Orchard Villa.
 *
 *   npx tsx scripts/assign-pitch-rhythm-teacher.ts            # dry run
 *   npx tsx scripts/assign-pitch-rhythm-teacher.ts --apply     # write it
 *
 * Two different situations wearing the same shape, and only one of them sticks.
 *
 * Van E. Blanton's 55 sessions carry no teacher at all — YMU-A names nobody on
 * those events, which is why they turned up in the import's "needs a person
 * named in YMU-A" list. Writing him here fills a hole, and the import's
 * clearing pass only touches sessions from BEFORE the current year, so this
 * survives the next run.
 *
 * Orchard Villa's 56 say Andrea Coiro, because that is what YMU-A says. This
 * is a handover, not a correction, and YMU was explicit that it covers the
 * whole year rather than only what is still ahead. But import-teachers-from-
 * ymua.ts relinks every session it has an assignment for, unconditionally —
 * so the NEXT RUN OF THAT IMPORT PUTS ANDREA COIRO BACK. This script buys the
 * export today; the durable fix is changing teacher_ids on those events in
 * YMU-A, or the organiser on the calendar they come from.
 *
 * Checked before writing: no visit anywhere observes Andrea Coiro, so nothing
 * is being detached from an observation. She keeps Young Men's Prep, Miami
 * Beach and Nautilus.
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();
const TEACHER = "De Anthony Williams";
const PROGRAMME = "Pitch & Rhythm";
const SCHOOLS = ["Van E. Blanton", "Orchard Villa"];

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  console.log(apply ? "APPLY — this writes to the database\n" : "DRY RUN — nothing is written\n");

  const teacher = await prisma.teacher.findFirst({ where: { name: TEACHER }, select: { id: true, name: true } });
  if (!teacher) throw new Error(`No teacher named ${TEACHER}`);
  const subject = await prisma.subject.findFirst({ where: { name: PROGRAMME }, select: { id: true } });
  if (!subject) throw new Error(`No programme named ${PROGRAMME}`);

  for (const name of SCHOOLS) {
    const school = await prisma.school.findFirst({ where: { name: { contains: name } }, select: { id: true, name: true } });
    if (!school) { console.log(`  ${name}: not found, skipped`); continue; }

    const before = await prisma.classSession.groupBy({
      by: ["teacherId"],
      where: { schoolId: school.id, subjectId: subject.id },
      _count: true,
    });
    const was = await Promise.all(before.map(async (b) => {
      const t = b.teacherId ? await prisma.teacher.findUnique({ where: { id: b.teacherId }, select: { name: true } }) : null;
      return `${b._count}× ${t?.name ?? "(nobody)"}`;
    }));
    console.log(`  ${school.name}: ${was.join(", ")}  →  ${teacher.name}`);

    if (apply) {
      const res = await prisma.classSession.updateMany({
        where: { schoolId: school.id, subjectId: subject.id },
        data: { teacherId: teacher.id },
      });
      console.log(`    ${res.count} sessions written`);
    }
  }

  if (!apply) console.log("\nDry run only. Re-run with --apply to write.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
