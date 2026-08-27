/**
 * CLI: create a user account.
 *
 * Usage:
 *   npm run create-user -- --email=rm@ymu.org --name="Jane Doe" --role=REGIONAL_MANAGER --region=NORTH
 *   npm run create-user -- --email=cpo@ymu.org --name="Pedro Diaz" --role=CPO
 *   npm run create-user -- --email=mentor@partner.org --name="Bob" --role=MENTOR --password=secret
 *
 * LEAVE --password OFF for an @ymu.org account. They sign in with "Continue
 * with Google", which means no password exists to be shared over WhatsApp,
 * reused elsewhere, or left behind when somebody leaves — Workspace already
 * decides who they are, and src/auth.config.ts refuses anything that is not
 * @ymu.org. --password is for the rare account outside the domain.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type Role =
  | "ADMIN"
  | "REGIONAL_MANAGER"
  | "AFTER_SCHOOL_MANAGER"
  | "CPO"
  | "OPERATIONS_MANAGER"
  | "ACADEMIC_MANAGER"
  | "MENTOR"
  | "INTERVENTIONIST";

const VALID_ROLES: Role[] = [
  "ADMIN",
  "REGIONAL_MANAGER",
  "AFTER_SCHOOL_MANAGER",
  "CPO",
  "OPERATIONS_MANAGER",
  "ACADEMIC_MANAGER",
  "MENTOR",
  "INTERVENTIONIST",
];

/**
 * Roles that must NOT carry a region.
 *
 * The Afterschool Manager runs programmes in every region and the oversight
 * roles read all of them; pinning either to one region would silently hide four
 * fifths of the app from them, and it is the kind of mistake that looks like
 * missing data rather than a wrong flag.
 */
const REGIONLESS_ROLES: Role[] = [
  "AFTER_SCHOOL_MANAGER",
  "CPO",
  "OPERATIONS_MANAGER",
  "ACADEMIC_MANAGER",
  "ADMIN",
];

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

  if (region && REGIONLESS_ROLES.includes(role)) {
    console.error(
      `Role ${role} must not have a region — it covers all of them. Drop --region.`
    );
    process.exit(1);
  }

  if (!region && role === "REGIONAL_MANAGER") {
    console.error("A REGIONAL_MANAGER needs --region (NORTH, SOUTH, EAST, WEST or CENTRAL).");
    process.exit(1);
  }

  if (!password && !email.endsWith("@ymu.org")) {
    console.error(
      `${email} is outside @ymu.org, so Google sign-in will refuse it. Pass --password.`
    );
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

  // Reported from the row, not from the argument. An upsert without --password
  // leaves an existing hash alone, so saying "no password set" here was a lie
  // for any account that already had one.
  const saved = await prisma.user.findUnique({
    where: { email },
    select: { hashedPassword: true },
  });
  console.log(
    saved?.hashedPassword
      ? "  Signs in with Continue with Google, or with their existing password."
      : "  No password on this account — they sign in with Continue with Google."
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
