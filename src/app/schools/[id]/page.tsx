import { prisma } from "@/lib/prisma";

export default async function SchoolHomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const school = await prisma.school.findUnique({
    where: { id },
    select: { id: true, name: true, zipCode: true, availability: true },
  });

  if (!school) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5">
        School not found.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5">
      <h1 className="text-xl font-bold mb-1">{school.name}</h1>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Zip: {school.zipCode}
      </div>
      <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
        Esta página es el “home” de la escuela (Horarios). Por ahora, usa la pestaña de
        Profesores para gestionar el CRUD.
      </div>
    </div>
  );
}

