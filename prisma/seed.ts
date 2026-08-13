import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding regions...");

  // The five regions the YMU-A roster is filed under. West carries 23 schools
  // there, so omitting it here made them unimportable.
  const regions = [
    { name: "North", code: "NORTH" },
    { name: "South", code: "SOUTH" },
    { name: "Central", code: "CENTRAL" },
    { name: "East", code: "EAST" },
    { name: "West", code: "WEST" },
  ];

  for (const r of regions) {
    await prisma.region.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: r,
    });
    console.log(`  ✓ Region ${r.name} (${r.code})`);
  }

  console.log("Seeding admin user (Pedro)...");

  const adminEmail = process.env.ADMIN_EMAIL ?? "pedro@ymu.org";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme";
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Pedro",
      role: "ADMIN",
      hashedPassword,
    },
  });
  console.log(`  ✓ Admin user: ${adminEmail}`);

  console.log("Seeding placeholder quarters (2026-27)...");

  // PLACEHOLDER dates: four back-to-back 9-week (63-day) blocks. Starts
  // July 1 (before the school year officially begins) so visits confirmed
  // now, while testing, land inside Q1 instead of the gap before it. Swap
  // these for the real MDCPS 2026-27 grading-period calendar once it's
  // available — that's a data change (re-run this seed), not a code change.
  const schoolYear = "2026-27";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let cursor = new Date("2026-07-01T00:00:00Z");
  const quarterLabels = ["Q1", "Q2", "Q3", "Q4"];

  for (const label of quarterLabels) {
    const startDate = cursor;
    const endDate = new Date(cursor.getTime() + 9 * WEEK_MS);
    await prisma.quarter.upsert({
      where: { schoolYear_label: { schoolYear, label } },
      update: { startDate, endDate },
      create: { schoolYear, label, startDate, endDate },
    });
    console.log(`  ✓ ${schoolYear} ${label}: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`);
    cursor = endDate;
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
