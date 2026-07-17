/**
 * Deduplicates schools by name.
 *
 * Usage:
 *   npm run dedupe-schools                  — dry-run: shows what WOULD happen
 *   npm run dedupe-schools -- --confirm     — actually deactivates duplicates
 *   npm run dedupe-schools -- --restore     — reactivates all dedupe-deactivated schools
 *
 * Instead of deleting, duplicates are marked active=false and their availability
 * field is replaced with a JSON marker so --restore can undo the operation.
 * Child rows (Visit, VisitRule, Teacher, ClassSession) are reassigned to the
 * keeper row before deactivation.
 */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

const DEDUPE_MARKER = "_dedupeDeactivated";

type DedupeAvailability = {
  _dedupeDeactivated: string; // ISO date
  _originalAvailability: string;
};

function buildMarker(originalAvailability: string): string {
  const marker: DedupeAvailability = {
    _dedupeDeactivated: new Date().toISOString().slice(0, 10),
    _originalAvailability: originalAvailability,
  };
  return JSON.stringify(marker);
}

function parseMarker(availability: string): DedupeAvailability | null {
  try {
    const parsed = JSON.parse(availability);
    if (parsed && typeof parsed[DEDUPE_MARKER] === "string") {
      return parsed as DedupeAvailability;
    }
  } catch {
    // not JSON or wrong shape
  }
  return null;
}

// ─── Restore mode ─────────────────────────────────────────────────────────────

async function restore() {
  console.log("\n─── Restore mode ────────────────────────────────────────────\n");

  const allInactive = await prisma.school.findMany({
    where: { active: false },
    select: { id: true, name: true, regionId: true, availability: true },
  });

  const deduped = allInactive.filter((s) => parseMarker(s.availability) !== null);

  if (deduped.length === 0) {
    console.log("No schools found that were deactivated by the dedupe script.");
    return;
  }

  console.log(`Found ${deduped.length} school(s) to restore:\n`);

  for (const school of deduped) {
    const marker = parseMarker(school.availability)!;
    console.log(
      `  Restoring "${school.name}" (id=${school.id})  — was deactivated on ${marker._dedupeDeactivated}`
    );
    await prisma.school.update({
      where: { id: school.id },
      data: {
        active: true,
        availability: marker._originalAvailability,
      },
    });
  }

  console.log(`\n  ✓ Restored ${deduped.length} school(s).\n`);
}

// ─── Dedupe mode ──────────────────────────────────────────────────────────────

async function dedupe(confirm: boolean) {
  const dryRun = !confirm;
  console.log(dryRun
    ? "\n─── DRY RUN (pass --confirm to execute) ────────────────────\n"
    : "\n─── EXECUTING deduplication ────────────────────────────────\n"
  );

  // Only consider active schools as candidates — skip already-deactivated ones.
  const allSchools = await prisma.school.findMany({
    where: { active: true },
    select: { id: true, name: true, regionId: true, lat: true, lng: true, availability: true },
    orderBy: { name: "asc" },
  });

  const byName = new Map<string, typeof allSchools>();
  for (const school of allSchools) {
    const key = school.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(school);
  }

  const duplicateGroups = [...byName.values()].filter((g) => g.length > 1);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate school names found among active schools. Nothing to do.");
    return;
  }

  // Fetch CENTRAL region id so we can deprioritise it.
  const centralRegion = await prisma.region.findFirst({
    where: { code: "CENTRAL" },
    select: { id: true },
  });
  const centralId = centralRegion?.id ?? null;

  console.log(`Found ${duplicateGroups.length} duplicate group(s):\n`);

  let totalToDeactivate = 0;
  let totalToReassign = 0;

  for (const group of duplicateGroups) {
    // Pick the keeper:
    //   Priority: (a) non-CENTRAL regionId, (b) has lat/lng, (c) lexicographically first id
    const keeper = group.slice().sort((a, b) => {
      const aIsNonCentral = a.regionId !== centralId ? 0 : 1;
      const bIsNonCentral = b.regionId !== centralId ? 0 : 1;
      if (aIsNonCentral !== bIsNonCentral) return aIsNonCentral - bIsNonCentral;

      const aHasCoords = a.lat != null && a.lng != null ? 0 : 1;
      const bHasCoords = b.lat != null && b.lng != null ? 0 : 1;
      if (aHasCoords !== bHasCoords) return aHasCoords - bHasCoords;

      return a.id < b.id ? -1 : 1;
    })[0];

    const duplicates = group.filter((s) => s.id !== keeper.id);

    console.log(`  "${group[0].name}"`);
    console.log(
      `    KEEP   id=${keeper.id}  regionId=${keeper.regionId ?? "null"}  lat=${keeper.lat ?? "null"}`
    );

    for (const dup of duplicates) {
      // Count child rows that would be reassigned.
      const [visits, visitRules, teachers, classSessions] = await Promise.all([
        prisma.visit.count({ where: { schoolId: dup.id } }),
        prisma.visitRule.count({ where: { schoolId: dup.id } }),
        prisma.teacher.count({ where: { schoolId: dup.id } }),
        prisma.classSession.count({ where: { schoolId: dup.id } }),
      ]);

      const childCount = visits + visitRules + teachers + classSessions;
      totalToReassign += childCount;
      totalToDeactivate++;

      console.log(
        `    DEACT  id=${dup.id}  regionId=${dup.regionId ?? "null"}  lat=${dup.lat ?? "null"}`
      );
      if (childCount > 0) {
        console.log(
          `           → reassign ${visits} Visit(s), ${visitRules} VisitRule(s), ${teachers} Teacher(s), ${classSessions} ClassSession(s) to keeper`
        );
      }

      if (!dryRun) {
        // Reassign child rows to the keeper.
        await Promise.all([
          prisma.visit.updateMany({ where: { schoolId: dup.id }, data: { schoolId: keeper.id } }),
          prisma.visitRule.updateMany({ where: { schoolId: dup.id }, data: { schoolId: keeper.id } }),
          prisma.teacher.updateMany({ where: { schoolId: dup.id }, data: { schoolId: keeper.id } }),
          prisma.classSession.updateMany({ where: { schoolId: dup.id }, data: { schoolId: keeper.id } }),
        ]);

        // Deactivate (never delete).
        await prisma.school.update({
          where: { id: dup.id },
          data: {
            active: false,
            availability: buildMarker(dup.availability),
          },
        });
      }
    }
  }

  console.log(`\n─── ${dryRun ? "Dry-run" : "Execution"} summary ────────────────────────────────`);
  console.log(`  Duplicate groups found  : ${duplicateGroups.length}`);
  console.log(`  Schools to deactivate   : ${totalToDeactivate}`);
  console.log(`  Child rows to reassign  : ${totalToReassign}`);
  if (dryRun) {
    console.log(`\n  Run with --confirm to apply these changes.`);
  } else {
    console.log(`\n  Done. Run with --restore to undo.`);
  }
  console.log(`─────────────────────────────────────────────────────────────\n`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doRestore = args.includes("--restore");
  const doConfirm = args.includes("--confirm");

  if (doRestore && doConfirm) {
    console.error("Error: --restore and --confirm are mutually exclusive.");
    process.exit(1);
  }

  if (doRestore) {
    await restore();
  } else {
    await dedupe(doConfirm);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
