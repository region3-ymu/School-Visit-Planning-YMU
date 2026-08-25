import dotenv from "dotenv"; dotenv.config();
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
// Confirmado por el usuario: ya no trabajan ahi, o son error de escritura.
const GONE = ["Luis Ocasio", "Camila Olmos", "Robby Robbinette", "Bret Kamer"];
(async () => {
  const schools = await p.school.findMany({ select: { name: true } });
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const schoolNames = new Set(schools.map(s => norm(s.name)));

  const orphans = await p.teacher.findMany({
    where: { externalId: null, classSessions: { none: {} } },
    select: { id: true, name: true },
  });

  const esNombreDeEscuela = orphans.filter(t => schoolNames.has(norm(t.name)) || /k-8|senior high|middle school|elementary|academy|center|westview/i.test(t.name));
  const yaNoEstan = orphans.filter(t => GONE.includes(t.name));
  const borrar = [...new Map([...esNombreDeEscuela, ...yaNoEstan].map(t => [t.id, t])).values()];
  const quedan = orphans.filter(t => !borrar.some(b => b.id === t.id));

  console.log(`Huerfanas totales: ${orphans.length}`);
  console.log(`  nombres de escuela: ${esNombreDeEscuela.length}`);
  console.log(`  personas que ya no estan / typo: ${yaNoEstan.length} (${yaNoEstan.map(t=>t.name).join(", ")})`);
  console.log(`  -> a BORRAR: ${borrar.length}`);
  console.log(`  -> se quedan: ${quedan.length} (${[...new Set(quedan.map(t=>t.name))].join(", ")})`);

  if (!process.argv.includes("--apply")) { console.log("\nDRY RUN. Usa --apply."); return; }
  const r = await p.teacher.deleteMany({ where: { id: { in: borrar.map(t => t.id) } } });
  console.log(`\nBorradas: ${r.count}`);
  console.log(`Profesores restantes: ${await p.teacher.count()} (reales: ${await p.teacher.count({ where: { externalId: { not: null } } })})`);
})().finally(()=>p.$disconnect());
