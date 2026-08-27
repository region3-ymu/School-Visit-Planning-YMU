/**
 * Who has an account, what they can do, and how they sign in.
 *
 *   npm run list-users
 *
 * Read-only. Prints no password material — there is none to print: passwords
 * are stored as bcrypt hashes, which cannot be turned back into a password by
 * this script or by anybody else.
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { ROLE_LABELS, canAdministerApp, canPlanVisits, seesAllRegions, tabsForRole } from "../src/lib/permissions";

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      name: true,
      role: true,
      isAppAdmin: true,
      hashedPassword: true,
      region: { select: { code: true } },
      managedRegion: { select: { code: true } },
      accounts: { select: { provider: true } },
      _count: { select: { visits: true } },
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  console.log(`${users.length} account(s)\n`);
  for (const u of users) {
    const signIn = [
      u.accounts.some((a) => a.provider === "google") ? "Google (linked)" : null,
      u.hashedPassword ? "password" : null,
    ].filter(Boolean);
    console.log(`${u.email}`);
    console.log(
      `  ${u.name ?? "(no name)"} — ${ROLE_LABELS[u.role]}` +
        // Not repeated for the ADMIN role, where it would read "App
        // Administrator + app administrator".
        (u.isAppAdmin && u.role !== "ADMIN" ? " + app administrator" : "")
    );
    console.log(
      `  region: ${u.region?.code ?? (seesAllRegions(u.role) ? "all regions" : "none")}` +
        (u.managedRegion ? ` · manages ${u.managedRegion.code}` : "")
    );
    console.log(`  sign in: ${signIn.length ? signIn.join(" or ") : "Google (not yet linked)"}`);
    console.log(`  tabs: ${tabsForRole(u.role).join(", ")}`);
    console.log(`  can plan/record visits: ${canPlanVisits(u.role) ? "yes" : "no (read-only)"}`);
    console.log(`  can administer the app: ${canAdministerApp(u) ? "yes" : "no"}`);
    console.log(`  visits recorded: ${u._count.visits}`);
    console.log();
  }

  const regions = await prisma.region.findMany({
    select: { code: true, manager: { select: { email: true } }, _count: { select: { schools: true } } },
    orderBy: { code: "asc" },
  });
  console.log("regions:");
  for (const r of regions) {
    console.log(
      `  ${r.code.padEnd(8)} ${String(r._count.schools).padStart(3)} schools — ` +
        `${r.manager?.email ?? "NO MANAGER ASSIGNED"}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
