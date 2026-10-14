import type { PrismaClient } from "@prisma/client";
import { normalizeSchoolName } from "./schoolNames";

/**
 * Importing YMU-A's school roster into SVP — shared by the manual script
 * (scripts/import-from-ymua.ts, which writes a review CSV first) and the
 * nightly cron (#50), so both reconcile exactly the same way.
 *
 * YMU-A is the source of truth for which schools exist, where they are,
 * which region they belong to and which Google calendar is theirs.
 */

// Not schools — YMU-A's own office, used there as a GPS test fixture, and
// the demo-mode site, which exists only to drive YMU-A's walkthrough.
export const EXCLUDED_NAMES = new Set(["YMU OFFICE TESTING", "YMU DEMO SITE"]);

export type YmuaSchool = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  google_calendar_id: string | null;
};

/**
 * US ZIP out of a free-text address; the column is non-null with a "" default.
 * Anchored to the END of the string: the street number ("12829 SW 272nd St,
 * ...") is just as often 5 digits as the ZIP is, and a match anywhere in the
 * address grabs whichever comes first.
 */
export function extractZip(address: string | null): string {
  const match = address?.trim().match(/(\d{5})(?:-\d{4})?\s*$/);
  return match ? match[1] : "";
}

export type PlanRow = {
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

/** What would happen to each YMU-A school. Reads only. */
export async function planYmuaImport(prisma: PrismaClient, roster: YmuaSchool[]): Promise<PlanRow[]> {
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

  return plan;
}

/** Applies a plan. One bad row never abandons the rest. */
export async function applyYmuaImport(
  prisma: PrismaClient,
  plan: PlanRow[],
): Promise<{ created: number; updated: number; failures: string[] }> {
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

  return { created, updated, failures };
}

/**
 * The roster from YMU-A's /api/school-roster, behind the secret the two apps
 * already share (APP_FEEDBACK_RELAY_SECRET) — SVP does not hold YMU-A's
 * service-role key.
 */
export async function fetchYmuaRoster(): Promise<YmuaSchool[]> {
  const base = (process.env.YMUA_APP_URL ?? "https://ymu-a-navy.vercel.app").replace(/\/$/, "");
  const secret = process.env.APP_FEEDBACK_RELAY_SECRET;
  if (!secret) throw new Error("APP_FEEDBACK_RELAY_SECRET is not set, so YMU-A's roster can't be read.");
  const res = await fetch(`${base}/api/school-roster`, {
    headers: { "x-ymu-apps-secret": secret },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { schools?: YmuaSchool[]; error?: string } | null;
  if (!res.ok || !body?.schools) {
    throw new Error(`YMU-A roster: ${body?.error ?? `HTTP ${res.status}`}`);
  }
  return body.schools;
}
