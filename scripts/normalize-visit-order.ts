/**
 * Give every visit its own slot within its day.
 *
 * Visits logged before route order existed all landed on one timestamp, so a
 * day with three stops had a three-way tie and listed in whatever order the
 * database felt like. Benjamin Franklin, Carrie P. Meek and Henry E. S. Reeves
 * all sat at 13:00 on Aug 13.
 *
 * Ties are broken by when each was entered, which is the order they were driven
 * — nobody logs a day backwards. A day already carrying distinct slots keeps its
 * order untouched, so a deliberate reorder is not undone.
 *
 * Usage:
 *   npx tsx scripts/normalize-visit-order.ts            # dry run
 *   npx tsx scripts/normalize-visit-order.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { dayKeyInAppZone, zonedDayStart } from "../src/lib/timezone";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();
const FIRST_SLOT_HOUR = 9;
const SLOT_MS = 3600_000;

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  console.log(apply ? "APPLY — this writes\n" : "DRY RUN — nothing is written\n");

  const visits = await prisma.visit.findMany({
    where: { status: "DONE" },
    select: { id: true, visitedById: true, plannedStartDateTime: true, createdAt: true, school: { select: { name: true } } },
    orderBy: [{ plannedStartDateTime: "asc" }, { createdAt: "asc" }],
  });

  const byUserDay = new Map<string, typeof visits>();
  for (const v of visits) {
    const key = `${v.visitedById ?? "none"}|${dayKeyInAppZone(v.plannedStartDateTime)}`;
    byUserDay.set(key, [...(byUserDay.get(key) ?? []), v]);
  }

  let changed = 0;
  for (const [key, dayVisits] of byUserDay) {
    const dayKey = key.split("|")[1];
    const slots = new Set(dayVisits.map((v) => v.plannedStartDateTime.getTime()));
    // Distinct already: an order somebody chose, left alone.
    if (slots.size === dayVisits.length) continue;

    console.log(`${dayKey} — ${dayVisits.length} stops, ${slots.size} distinct slot(s):`);
    for (const [i, v] of dayVisits.entries()) {
      const want = new Date(zonedDayStart(dayKey).getTime() + (FIRST_SLOT_HOUR + i) * SLOT_MS);
      const same = want.getTime() === v.plannedStartDateTime.getTime();
      console.log(`   ${i + 1}. ${v.school.name.padEnd(34)} ${same ? "unchanged" : `→ slot ${i + 1}`}`);
      if (same) continue;
      if (apply) {
        await prisma.visit.update({
          where: { id: v.id },
          data: { plannedStartDateTime: want, plannedEndDateTime: new Date(want.getTime() + SLOT_MS) },
        });
      }
      changed += 1;
    }
  }

  console.log(`\n${apply ? "Updated" : "Would update"}: ${changed} visit(s).`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
