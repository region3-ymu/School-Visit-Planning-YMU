/**
 * Import the master programmes spreadsheet as reference text for the timetable.
 *
 * Whether a programme runs on A days or B days lives only in that sheet. The
 * calendar can show a class alternating weeks, but has no idea which letter a
 * school considers itself on, so the app could say "alternating" and no more.
 *
 * Read-only reference: nothing plans, prices or schedules against these rows.
 * They are shown beside a school's timetable and nowhere else, so a stale one
 * misleads a reader rather than corrupting a visit.
 *
 * Usage:
 *   npx tsx scripts/import-schedule-notes.ts --file="…/MASTER PROGRAMS….csv"
 *   npx tsx scripts/import-schedule-notes.ts --file="…" --apply
 *
 * A dry run reports what matched and, more usefully, what didn't: the sheet
 * names schools its own way ("Booker T", "Carrie P. Meek K-8") and those have to
 * line up with the roster before anything is written.
 *
 * Rows for a school already imported are replaced, so re-running the sheet after
 * an edit leaves no orphans behind.
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import dotenv from "dotenv";
import { parse } from "csv-parse/sync";
import { normalizeSchoolName } from "../src/lib/schoolNames";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

/** Column order in the sheet; the programme column has no header of its own. */
const COL = { status: 0, school: 1, program: 2, period: 3, times: 4, type: 5, days: 6, teacher: 7 };

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/**
 * Loose key for lining the sheet's school names up with the roster's.
 *
 * The sheet writes "Booker T" for Booker T. Washington Senior High and "Carrie
 * P. Meek K-8" for Carrie P. Meek, so the school-type words have to come off
 * before comparing. normalizeSchoolName upper-cases, which is why this
 * lower-cases first — stripping [^a-z0-9] against upper case leaves nothing at
 * all, and every school then shares one empty key.
 */
function schoolKey(name: string): string {
  return normalizeSchoolName(name)
    .toLowerCase()
    .replace(/\b(senior high school|senior high|high school|middle school|elementary school|elementary|middle|hs|ms|k-?8 center|k-?8|center|academy|school)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

async function main() {
  const file = arg("file");
  const apply = process.argv.slice(2).includes("--apply");
  if (!file) throw new Error('Pass --file="path/to/master.csv"');
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);

  console.log(apply ? "APPLY — this writes to the database\n" : "DRY RUN — nothing is written\n");

  const rows: string[][] = parse(fs.readFileSync(file), { relax_column_count: true, skip_empty_lines: false });
  const schools = await prisma.school.findMany({ select: { id: true, name: true } });

  const ambiguous = new Map<string, string[]>();

  // Stripping "senior high" and "middle school" makes Homestead Senior High and
  // Homestead Middle School the same key, so the loose key is only a fallback:
  // an exact name match is tried first and settles those on its own.
  const byExact = new Map<string, { id: string; name: string }>();
  const byLoose = new Map<string, { id: string; name: string }[]>();
  for (const s of schools) {
    byExact.set(normalizeSchoolName(s.name).toLowerCase(), s);
    const k = schoolKey(s.name);
    byLoose.set(k, [...(byLoose.get(k) ?? []), s]);
  }

  /** Exact name, then the stripped key, then a unique prefix ("Booker T"). */
  function findSchool(raw: string): { id: string; name: string } | null {
    const exact = byExact.get(normalizeSchoolName(raw).toLowerCase());
    if (exact) return exact;

    const k = schoolKey(raw);
    const loose = byLoose.get(k) ?? [];
    if (loose.length === 1) return loose[0];
    // More than one roster school reduces to this key; guessing between them is
    // how the wrong school ends up with someone else's timetable.
    if (loose.length > 1) {
      ambiguous.set(raw, loose.map((s) => s.name));
      return null;
    }

    const prefixed = [...byLoose.entries()].filter(([rk]) => rk.startsWith(k) && k.length >= 5);
    if (prefixed.length === 1 && prefixed[0][1].length === 1) return prefixed[0][1][0];
    if (prefixed.length > 1) ambiguous.set(raw, prefixed.flatMap(([, v]) => v.map((s) => s.name)));
    return null;
  }

  type Note = {
    schoolId: string;
    schoolName: string;
    subjectName: string;
    dayPattern: string | null;
    period: string | null;
    timesText: string | null;
    teacherName: string | null;
    scheduleStatus: string | null;
    sourceRow: number;
  };
  const notes: Note[] = [];
  const unmatched = new Map<string, number>();

  rows.forEach((row, i) => {
    const lineNo = i + 1;
    if (i === 0) return; // header
    const schoolName = (row[COL.school] ?? "").trim();
    const program = (row[COL.program] ?? "").trim();
    // Trailing blank rows and the free-text notes block at the foot of the sheet.
    if (!schoolName || !program) return;

    const match = findSchool(schoolName);
    if (!match) {
      unmatched.set(schoolName, (unmatched.get(schoolName) ?? 0) + 1);
      return;
    }

    const clean = (v: string | undefined) => {
      const t = (v ?? "").trim();
      return t.length > 0 ? t : null;
    };
    notes.push({
      schoolId: match.id,
      schoolName: match.name,
      subjectName: program,
      dayPattern: clean(row[COL.days]),
      period: clean(row[COL.period]),
      timesText: clean(row[COL.times]),
      teacherName: clean(row[COL.teacher]),
      scheduleStatus: clean(row[COL.status]),
      sourceRow: lineNo,
    });
  });

  console.log(`Rows read: ${rows.length}   Programme lines matched to a school: ${notes.length}`);
  if (ambiguous.size) {
    console.log(`\nSheet names matching more than one school — skipped rather than guessed:`);
    for (const [name, options] of ambiguous) console.log(`  "${name}" → ${options.join(" | ")}`);
  }
  if (unmatched.size) {
    console.log(`\nSchool names in the sheet with no roster match (${unmatched.size}) — these are skipped:`);
    for (const [name, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name.padEnd(40)} ${n} line${n === 1 ? "" : "s"}`);
    }
  }

  const patterns = new Map<string, number>();
  for (const n of notes) patterns.set(n.dayPattern ?? "(blank)", (patterns.get(n.dayPattern ?? "(blank)") ?? 0) + 1);
  console.log(`\nDay patterns found:`);
  for (const [p, n] of [...patterns.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(46)} ${n}`);
  }

  console.log(`\nSample:`);
  for (const n of notes.slice(0, 8)) {
    console.log(`  ${n.schoolName.padEnd(32)} ${n.subjectName.padEnd(24)} ${(n.dayPattern ?? "—").padEnd(30)} ${n.teacherName ?? ""}`);
  }

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.`);
    return;
  }

  // Replace per school rather than upserting row by row: a programme dropped
  // from the sheet should disappear, not linger.
  const touched = [...new Set(notes.map((n) => n.schoolId))];
  const removed = await prisma.programScheduleNote.deleteMany({ where: { schoolId: { in: touched } } });

  // Every line is kept. Elementary programmes repeat the same subject for each
  // day they run — Arcola Lake's P+R on Tuesdays, Thursdays and Fridays — and
  // the day is exactly what this table is for.
  const data = notes.map(({ schoolName: _schoolName, ...rest }) => rest);
  const { count: written } = await prisma.programScheduleNote.createMany({ data });

  console.log(`\nReplaced ${removed.count} note(s) across ${touched.length} schools; wrote ${written}.`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
