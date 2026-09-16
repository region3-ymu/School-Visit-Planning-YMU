/**
 * What the Weekly Planner does with the user's own edits.
 *
 * No database: resolveOverrides is pure, and these are the cases that actually
 * went wrong on screen — a deleted visit reappearing on the next
 * recalculation, a postponed one showing on both days at once, a school that
 * could not be put back on a day it had been taken off, and an evening
 * afterschool class filed under the wrong day because the day key was built in
 * the host's zone rather than Miami's.
 *
 *   npm run check:overrides
 */
import { resolveOverrides, hasPinOnDay, splitDayScope } from "../src/lib/plannerOverrides";
import type { VisitInfo } from "../src/lib/types";

const WEEK = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
// Midday UTC, the shape the planner writes: inside the Miami day either way.
const on = (dayKey: string) => new Date(`${dayKey}T12:00:00Z`);
// An afterschool class at 20:00 Miami — 00:00 the NEXT day in UTC, which is
// what date-fns format() used to file it under on Vercel.
const evening = (dayKey: string) => new Date(`${dayKey}T00:00:00Z`);

let failures = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

const ov = (o: Partial<VisitInfo>) => o;

// 1. A hand-added visit becomes one pin.
{
  const { pins, skippedDays } = resolveOverrides(
    [ov({ schoolId: "s1", date: on("2026-09-17"), isPinned: true, startTime: "08:30", endTime: "09:30" })],
    WEEK
  );
  check("add: one pin", pins, [{ schoolId: "s1", dayKey: "2026-09-17", startTime: "08:30", endTime: "09:30" }]);
  check("add: nothing skipped", [...skippedDays], []);
}

// 2. Deleting that hand-added visit must leave NO pin — the bug where it came back.
{
  const { pins, skippedDays } = resolveOverrides(
    [
      ov({ schoolId: "s1", date: on("2026-09-17"), isPinned: true, startTime: "08:30", endTime: "09:30" }),
      ov({ schoolId: "s1", date: on("2026-09-17"), isSkipped: true }),
    ],
    WEEK
  );
  check("delete a hand-added visit: pin gone", pins, []);
  check("delete a hand-added visit: day skipped", [...skippedDays], ["s1:2026-09-17"]);
}

// 3. Postponing it Thu -> Fri must leave exactly one pin, on Friday.
{
  const { pins, skippedDays } = resolveOverrides(
    [
      ov({ schoolId: "s1", date: on("2026-09-17"), isPinned: true, startTime: "08:30", endTime: "09:30" }),
      ov({ schoolId: "s1", date: on("2026-09-17"), isSkipped: true }),
      ov({ schoolId: "s1", date: on("2026-09-18"), isPinned: true, startTime: "11:05", endTime: "12:05" }),
    ],
    WEEK
  );
  check("postpone: one pin, on the target day", pins, [
    { schoolId: "s1", dayKey: "2026-09-18", startTime: "11:05", endTime: "12:05" },
  ]);
  check("postpone: old day stays skipped", [...skippedDays], ["s1:2026-09-17"]);
}

// 4. Putting a school back on a day it was taken off.
{
  const { pins, skippedDays } = resolveOverrides(
    [
      ov({ schoolId: "s1", date: on("2026-09-17"), isSkipped: true }),
      ov({ schoolId: "s1", date: on("2026-09-17"), isPinned: true, startTime: "08:30", endTime: "09:30" }),
    ],
    WEEK
  );
  check("re-add after delete: pinned again", pins.length, 1);
  check("re-add after delete: no longer skipped", [...skippedDays], []);
  check("re-add after delete: db skip is overridden", hasPinOnDay(pins, "s1:2026-09-17"), true);
}

// 5. Two classes at one school on one day are two pins; skipping that day drops both.
{
  const both: Partial<VisitInfo>[] = [
    ov({ schoolId: "s1", date: on("2026-09-17"), isPinned: true, startTime: "09:00", endTime: "10:00" }),
    ov({ schoolId: "s1", date: on("2026-09-17"), isPinned: true, startTime: "13:40", endTime: "14:40" }),
  ];
  check("two classes, one school, one day: two pins", resolveOverrides(both, WEEK).pins.length, 2);
  const after = resolveOverrides([...both, ov({ schoolId: "s1", date: on("2026-09-17"), isSkipped: true })], WEEK);
  check("skipping that day drops both", after.pins.length, 0);
}

// 6. An override for another week is stale and ignored.
{
  const { pins } = resolveOverrides(
    [ov({ schoolId: "s1", date: on("2026-09-24"), isPinned: true, startTime: "08:30", endTime: "09:30" })],
    WEEK
  );
  check("last week's override ignored", pins, []);
}

// 7. A 20:00 Miami afterschool class is filed under its Miami day, not UTC's.
{
  const { pins } = resolveOverrides(
    [ov({ schoolId: "s1", date: evening("2026-09-18"), isPinned: true, startTime: "20:00", endTime: "21:00" })],
    WEEK
  );
  check("evening class keeps its Miami day", pins[0]?.dayKey, "2026-09-17");
}

// 8. Round-tripping the scope key.
check("splitDayScope", splitDayScope("cmqpc:nlh50002:2026-09-17"), {
  schoolId: "cmqpc:nlh50002",
  dayKey: "2026-09-17",
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
