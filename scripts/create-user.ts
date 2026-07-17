/**
 * CLI: create a user account.
 *
 * Usage:
 *   npm run create-user -- --email=rm@ymu.org --name="Jane Doe" --role=REGIONAL_MANAGER --region=NORTH --password=secret
 *   npm run create-user -- --email=mentor@partner.org --name="Bob" --role=MENTOR --password=secret
 *
 * For @ymu.org accounts, --password is optional (they'll sign in via Google OAuth).
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type Role = "ADMIN" | "REGIONAL_MANAGER" | "AFTER_SCHOOL_MANAGER" | "MENTOR" | "INTERVENTIONIST";
const VALID_ROLES: Role[] = ["ADMIN", "REGIONAL_MANAGER", "AFTER_SCHOOL_MANAGER", "MENTOR", "INTERVENTIONIST"];

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const get = (flag: string) => {
    const match = args.find((a) => a.startsWith(`--${flag}=`));
    return match ? match.slice(`--${flag}=`.length) : null;
  };
  return {
    email: get("email"),
    name: get("name"),
    role: get("role")?.toUpperCase() as Role | null,
    region: get("region")?.toUpperCase() ?? null,
    password: get("password"),
  };
}

async function main() {
  const { email, name, role, region, password } = parseArgs(process.argv);

  if (!email || !role) {
    console.error("Usage: npm run create-user -- --email=EMAIL --role=ROLE [--name=NAME] [--region=CODE] [--password=PASS]");
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  let regionId: string | null = null;
  if (region) {
    const regionRecord = await prisma.region.findUnique({ where: { code: region } });
    if (!regionRecord) {
      console.error(`Region "${region}" not found. Run db:seed first.`);
      process.exit(1);
    }
    regionId = regionRecord.id;
  }

  const hashedPassword = password ? await bcrypt.hash(password, 12) : null;

  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role, regionId, ...(hashedPassword ? { hashedPassword } : {}) },
    create: { email, name, role, regionId, hashedPassword },
  });

  if (role === "REGIONAL_MANAGER" && regionId) {
    await prisma.region.update({
      where: { id: regionId },
      data: { regionalManagerId: user.id },
    });
    console.log(`  Assigned ${email} as manager of region ${region}`);
  }

  console.log(`User created/updated: ${email} (${role})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
