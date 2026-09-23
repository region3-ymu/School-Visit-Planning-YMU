import dotenv from "dotenv"; dotenv.config();
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const school = await prisma.school.findFirst({ where: { name: "Edison Park K-8 Center" } });
  console.log("availability:", school?.availability);

  const withAvail = await prisma.school.findMany({ where: { NOT: { availability: "[]" } }, select: { name: true, availability: true } });
  console.log(`\nEscuelas con 'availability' distinto de "[]": ${withAvail.length}`);
  for (const s of withAvail) console.log(`  ${s.name}: ${s.availability}`);
})().finally(() => prisma.$disconnect());
