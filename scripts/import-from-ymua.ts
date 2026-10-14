/**
 * Import the school roster from the YMU-A app (Supabase) into this app.
 *
 * YMU-A is the source of truth for which schools exist, where they are, which
 * region they belong to, and which Google calendar is theirs. All of that is
 * already geocoded and human-reviewed there, so importing beats re-deriving it.
 *
 * Usage:
 *   npm run import:ymua                      # dry run — writes ymua-import-review.csv
 *   npm run import:ymua -- --apply           # apply the plan to the database
 *   npm run import:ymua -- --file=roster.json --apply
 *
 * Two phases on purpose (the same shape YMU-A's own importer uses): the dry run
 * writes a reviewable plan and touches nothing, and only --apply writes. School
 * identity is easy to get wrong and expensive to unpick once visits and class
 * sessions hang off the wrong row.
 *
 * Reconcile logic, in order:
 *   1. externalId matches       → UPDATE in place (the re-sync path)
 *   2. normalized name matches an unclaimed local school → ADOPT it (stamp
 *      externalId, then update). This is what keeps the 11 seed schools from
 *      becoming duplicates of their YMU-A counterparts.
 *   3. otherwise                → CREATE
 *
 * Nothing is ever deactivated or deleted here; this import only adds and
 * updates. Retiring a school stays a deliberate manual act.
 *
 * Env (both already exist in the YMU-A checkout's .env.local):
 *   YMUA_SUPABASE_URL, YMUA_SUPABASE_SERVICE_ROLE_KEY
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  applyYmuaImport,
  fetchYmuaRoster,
  planYmuaImport,
  type YmuaSchool,
} from "../src/lib/ymuaImport";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const REVIEW_CSV = path.resolve("ymua-import-review.csv");

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let apply = false;
  let file: string | null = null;
  for (const arg of args) {
    if (arg === "--apply") { apply = true; continue; }
    const fileMatch = arg.match(/^--file=(.+)$/);
    if (fileMatch) { file = fileMatch[1]; continue; }
  }
  return { apply, file };
}

async function loadFromSupabase(): Promise<YmuaSchool[]> {
  const url = process.env.YMUA_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.YMUA_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set YMUA_SUPABASE_URL and YMUA_SUPABASE_SERVICE_ROLE_KEY (copy them from the YMU-A .env.local), or pass --file=roster.json."
    );
  }

  const query =
    "select=id,name,address,lat,lng,region,google_calendar_id&order=name.asc&limit=1000";
  const res = await fetch(`${url}/rest/v1/schools?${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`YMU-A Supabase returned ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as YmuaSchool[];
}

function loadFromFile(file: string): YmuaSchool[] {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array of schools.`);
  return parsed as YmuaSchool[];
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function main() {
  const { apply, file } = parseArgs(process.argv);

  // A file, else YMU-A's Supabase directly when its key is in .env.local,
  // else YMU-A's /api/school-roster (the path the nightly cron uses).
  const roster = file
    ? loadFromFile(file)
    : process.env.YMUA_SUPABASE_SERVICE_ROLE_KEY
      ? await loadFromSupabase()
      : await fetchYmuaRoster();
  console.log(`Loaded ${roster.length} schools from YMU-A${file ? ` (${file})` : ""}.`);

  const plan = await planYmuaImport(prisma, roster);

  const header = "action,ymua_id,name,address,region,calendar,matched_local,note";
  const lines = plan.map((r) =>
    [r.action, r.ymuaId, r.name, r.address, r.region, r.calendar, r.matchedLocal, r.note]
      .map(csvCell)
      .join(",")
  );
  fs.writeFileSync(REVIEW_CSV, `${header}\n${lines.join("\n")}\n`);

  const counts = plan.reduce<Record<string, number>>((acc, r) => {
    acc[r.action] = (acc[r.action] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Plan: ${counts.create ?? 0} create, ${counts.adopt ?? 0} adopt, ${counts.update ?? 0} update, ${counts.skip ?? 0} skip.`
  );
  console.log(`Review written to ${REVIEW_CSV}`);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to commit.");
    return;
  }

  const { created, updated, failures } = await applyYmuaImport(prisma, plan);

  console.log(`\nApplied: ${created} created, ${updated} updated.`);
  if (failures.length) {
    console.error(`\n${failures.length} row(s) failed:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
