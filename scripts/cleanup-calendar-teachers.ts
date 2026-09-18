import dotenv from "dotenv"; dotenv.config();
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
// Confirmed gone, or a misspelling of someone who is here under another
// spelling. Kept by name because these are judgements a person made, not
// something the data can tell you.
const GONE = ["Luis Ocasio", "Camila Olmos", "Robby Robbinette", "Bret Kamer"];

/**
 * Also remove any calendar-invented row holding no classes at all.
 *
 * The sync used to create a Teacher per name it saw, per school — so one person
 * became several rows, and the import then moved every class onto their single
 * real YMU-A row. What is left carries nothing: Renzo Vargas had three empty
 * rows beside the real one. Keeping them means a school's list shows the same
 * person twice, once with classes and once without, and an observation could be
 * filed against the empty one.
 */
const DELETE_ALL_EMPTY = true;
(async () => {
  const schools = await p.school.findMany({ select: { name: true } });
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const schoolNames = new Set(schools.map(s => norm(s.name)));

  const orphans = await p.teacher.findMany({
    where: { externalId: null, classSessions: { none: {} } },
    select: { id: true, name: true },
  });

  const isSchoolName = orphans.filter(t => schoolNames.has(norm(t.name)) || /k-8|senior high|middle school|elementary|academy|center|westview/i.test(t.name));
  const goneNow = orphans.filter(t => GONE.includes(t.name));
  const empties = DELETE_ALL_EMPTY ? orphans : [];
  const toDelete = [...new Map([...isSchoolName, ...goneNow, ...empties].map(t => [t.id, t])).values()];
  const kept = orphans.filter(t => !toDelete.some(b => b.id === t.id));

  console.log(`Orphans total: ${orphans.length}`);
  console.log(`  school names: ${isSchoolName.length}`);
  console.log(`  people no longer there / typos: ${goneNow.length} (${goneNow.map(t=>t.name).join(", ")})`);
  console.log(`  -> to DELETE: ${toDelete.length}`);
  console.log(`  -> kept: ${kept.length} (${[...new Set(kept.map(t=>t.name))].join(", ")})`);

  if (!process.argv.includes("--apply")) { console.log("\nDRY RUN. Use --apply."); return; }
  const r = await p.teacher.deleteMany({ where: { id: { in: toDelete.map(t => t.id) } } });
  console.log(`\nDeleted: ${r.count}`);
  console.log(`Teachers remaining: ${await p.teacher.count()} (real: ${await p.teacher.count({ where: { externalId: { not: null } } })})`);
})().finally(()=>p.$disconnect());
