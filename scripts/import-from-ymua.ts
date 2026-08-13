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
import { normalizeSchoolName } from "../src/lib/schoolNames";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const REVIEW_CSV = path.resolve("ymua-import-review.csv");

// Not a school — YMU-A's own office, used there as a GPS test fixture.
const EXCLUDED_NAMES = new Set(["YMU OFFICE TESTING"]);

type YmuaSchool = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  google_calendar_id: string | null;
};

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

/** US ZIP out of a free-text address; the column is non-null with a "" default. */
function extractZip(address: string | null): string {
  const match = address?.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : "";
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

type PlanRow = {
  action: "create" | "update" | "adopt" | "skip";
  ymuaId: string;
  name: string;
  address: string;
  region: string;
  calendar: string;
  matchedLocal: string;
  note: string;
  /** Present for update/adopt. */
  localId?: string;
  regionId?: string | null;
  lat?: number | null;
  lng?: number | null;
};

async function main() {
  const { apply, file } = parseArgs(process.argv);

  const roster = file ? loadFromFile(file) : await loadFromSupabase();
  console.log(`Loaded ${roster.length} schools from YMU-A${file ? ` (${file})` : ""}.`);

  const regions = await prisma.region.findMany({ select: { id: true, code: true } });
  const regionByCode = new Map(regions.map((r) => [r.code, r.id]));

  const localSchools = await prisma.school.findMany({
    select: { id: true, name: true, externalId: true, active: true },
  });
  const byExternalId = new Map(
    localSchools.filter((s) => s.externalId).map((s) => [s.externalId as string, s])
  );

  // Only schools not yet claimed by an import are adoptable. Group by
  // normalized name first: this database already holds duplicate pairs (an
  // active school carrying all the visits and class sessions, plus a
  // zero-data inactive twin), so "one name, one row" cannot be assumed.
  const unclaimedGroups = new Map<string, typeof localSchools>();
  for (const school of localSchools) {
    if (school.externalId) continue;
    const key = normalizeSchoolName(school.name);
    if (!unclaimedGroups.has(key)) unclaimedGroups.set(key, []);
    unclaimedGroups.get(key)!.push(school);
  }

  const unclaimedByName = new Map<string, { id: string; name: string }>();
  for (const [key, group] of unclaimedGroups) {
    // With duplicates, the active row is the real one — it is where the visit
    // history hangs. Adopting the inactive twin would strand that history.
    const candidates = group.length === 1 ? group : group.filter((s) => s.active);
    unclaimedByName.set(
      key,
      candidates.length === 1
        ? { id: candidates[0].id, name: candidates[0].name }
        : { id: "", name: "AMBIGUOUS" }
    );
  }

  const plan: PlanRow[] = [];

  for (const row of roster) {
    const name = row.name?.trim() ?? "";
    const normalized = normalizeSchoolName(name);
    const regionCode = row.region ? row.region.toUpperCase() : "";
    const regionId = regionCode ? regionByCode.get(regionCode) ?? null : null;

    const base = {
      ymuaId: row.id,
      name,
      address: row.address ?? "",
      region: regionCode,
      calendar: row.google_calendar_id ?? "",
      matchedLocal: "",
      regionId,
      lat: row.lat,
      lng: row.lng,
    };

    if (!name || EXCLUDED_NAMES.has(normalized)) {
      plan.push({ ...base, action: "skip", note: "Not a real school — excluded." });
      continue;
    }
    if (regionCode && !regionId) {
      plan.push({
        ...base,
        action: "skip",
        note: `No Region row with code ${regionCode} — run npm run db:seed first.`,
      });
      continue;
    }
    if (row.lat === null || row.lng === null) {
      plan.push({ ...base, action: "skip", note: "No coordinates in YMU-A — would break routing." });
      continue;
    }

    const existing = byExternalId.get(row.id);
    if (existing) {
      plan.push({ ...base, action: "update", localId: existing.id, matchedLocal: existing.name, note: "" });
      continue;
    }

    const adoptable = unclaimedByName.get(normalized);
    if (adoptable && adoptable.id) {
      unclaimedByName.delete(normalized);
      plan.push({
        ...base,
        action: "adopt",
        localId: adoptable.id,
        matchedLocal: adoptable.name,
        note: "Existing local school claimed by normalized-name match.",
      });
      continue;
    }
    if (adoptable && !adoptable.id) {
      plan.push({
        ...base,
        action: "create",
        note: "Two local schools share this normalized name — creating instead of adopting; dedupe by hand.",
      });
      continue;
    }

    plan.push({ ...base, action: "create", note: "" });
  }

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

  let created = 0;
  let updated = 0;
  const failures: string[] = [];

  for (const row of plan) {
    if (row.action === "skip") continue;

    const data = {
      name: row.name,
      address: row.address || null,
      zipCode: extractZip(row.address || null),
      lat: row.lat ?? null,
      lng: row.lng ?? null,
      geocodeSource: "ymu-a",
      regionId: row.regionId ?? null,
      googleCalendarId: row.calendar || null,
      active: true,
    };

    // One bad row must not abandon the import halfway through, leaving the
    // roster half-imported with no record of where it stopped.
    try {
      if (row.action === "create") {
        await prisma.school.create({ data: { ...data, externalId: row.ymuaId } });
        created += 1;
      } else {
        if (!row.localId) throw new Error("internal: no local school id to update");
        await prisma.school.update({
          where: { id: row.localId },
          data: { ...data, externalId: row.ymuaId },
        });
        updated += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${row.name}: ${message}`);
    }
  }

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
