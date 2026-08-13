/**
 * Re-derive the calendar↔school name-matching thresholds from the real roster.
 *
 * The numbers in src/lib/schoolNames.ts are empirical, and the roster changes.
 * This script is what makes them checkable instead of folklore.
 *
 * Usage:
 *   npm run check:matching                    # reads schools from the database
 *   npm run check:matching -- --file=roster.json
 *
 * Exits non-zero if any school's name would be auto-pinned onto a DIFFERENT
 * school — i.e. if NAME_MATCH_THRESHOLD has stopped being safe.
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { matchByName, NAME_MATCH_THRESHOLD, NAME_REVIEW_FLOOR } from "../src/lib/schoolNames";

dotenv.config();
dotenv.config({ path: ".env.local" });

// Calendar summary -> the school it really belongs to. Taken from YMU-A's
// calendar-coverage-report.csv (rows flagged pin_name_mismatch): the cases
// where Google's calendar name genuinely differs from the school's name.
const KNOWN_PAIRS: [string, string][] = [
  ["Arthur and Polly Mays Conservatory", "Arthur & Polly Mays Conservatory of the Arts"],
  ["Bowman Ashe K-8", "Bowman Ashe/Doolin K-8 Academy"],
  ["Carrie P. Meek/Westview K-8", "Carrie P. Meek"],
  ["Dr. Charles R. Drew K-8 Center", "Charles R. Drew K-8"],
  ["John Ferguson Senior High School", "John A. Ferguson Sr. High School"],
  ["Norland Senior High School", "Miami Norland Senior HS"],
];

async function loadSchools(): Promise<{ name: string }[]> {
  const fileArg = process.argv.slice(2).find((a) => a.startsWith("--file="));
  if (fileArg) {
    return JSON.parse(fs.readFileSync(path.resolve(fileArg.slice(7)), "utf-8"));
  }
  const prisma = new PrismaClient();
  try {
    return await prisma.school.findMany({ where: { active: true }, select: { name: true } });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const schools = await loadSchools();
  console.log(`Roster: ${schools.length} schools.`);
  console.log(`Thresholds: auto-pin >= ${NAME_MATCH_THRESHOLD}, review >= ${NAME_REVIEW_FLOOR}\n`);

  // False-positive sweep: hide each school, then match its own name against
  // the rest. Anything that comes back "matched" is a calendar this matcher
  // would silently attach to the wrong school.
  const mispins: { name: string; onto: string; score: number }[] = [];
  let worstNearMiss = { name: "", onto: "", score: 0 };

  for (const school of schools) {
    const others = schools.filter((o) => o.name !== school.name);
    const result = matchByName(school.name, others, (o) => o.name);
    if (result.status === "matched") {
      mispins.push({ name: school.name, onto: result.item.name, score: result.score });
    } else if (result.candidates[0] && result.candidates[0].score > worstNearMiss.score) {
      worstNearMiss = {
        name: school.name,
        onto: result.candidates[0].item.name,
        score: result.candidates[0].score,
      };
    }
  }

  console.log("Known calendar-name mismatches:");
  let autoPinned = 0;
  for (const [calendar, expected] of KNOWN_PAIRS) {
    const result = matchByName(calendar, schools, (s) => s.name);
    if (result.status === "matched") {
      const correct = result.item.name === expected;
      autoPinned += 1;
      console.log(
        `  ${correct ? "auto-pin  " : "WRONG PIN "} ${result.score.toFixed(3)}  "${calendar}" -> "${result.item.name}"`
      );
      if (!correct) process.exitCode = 1;
    } else {
      const top = result.candidates[0];
      console.log(
        `  review     ${top ? top.score.toFixed(3) : "  -  "}  "${calendar}" -> ${top ? `"${top.item.name}"` : "(no candidate)"}`
      );
      if (top && top.item.name !== expected) {
        console.log(`             ! top candidate is not the expected school ("${expected}")`);
        process.exitCode = 1;
      }
    }
  }
  console.log(
    `  ${autoPinned}/${KNOWN_PAIRS.length} auto-pinned; the rest go to CalendarSyncIssue for a human.`
  );

  console.log("\nFalse-positive sweep:");
  if (mispins.length === 0) {
    console.log(
      `  none — no school auto-pins onto another. Worst near-miss ${worstNearMiss.score.toFixed(3)}: "${worstNearMiss.name}" -> "${worstNearMiss.onto}"`
    );
    if (worstNearMiss.score >= NAME_MATCH_THRESHOLD - 0.02) {
      console.log("  ! that is uncomfortably close to the auto-pin threshold.");
    }
  } else {
    console.error(`  ${mispins.length} school(s) would be pinned onto the WRONG school:`);
    for (const m of mispins) {
      console.error(`    ${m.score.toFixed(3)}  "${m.name}" -> "${m.onto}"`);
    }
    console.error(`  Raise NAME_MATCH_THRESHOLD above ${Math.max(...mispins.map((m) => m.score)).toFixed(3)}.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
