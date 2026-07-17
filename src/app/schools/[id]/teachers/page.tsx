"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Trash2, Pencil, Plus } from "lucide-react";
import { deleteTeacher, getSchoolTeachers } from "@/app/actions";
import { useParams } from "next/navigation";

type TeacherRow = {
  id: string;
  name: string;
  subjects: string | null;
  createdAt: string;
};

export default function TeachersListPage() {
  const params = useParams<{ id: string }>();
  const schoolId = params?.id;
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!schoolId) {
      setTeachers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = await getSchoolTeachers(schoolId);
    setTeachers(rows as unknown as TeacherRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const handleDelete = async (teacherId: string) => {
    await deleteTeacher(teacherId);
    await load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Profesores</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Lista de profesores de esta escuela.
          </div>
        </div>
        <Link
          href={schoolId ? `/schools/${schoolId}/teachers/new` : "#"}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
        >
          <Plus size={16} />
          Agregar profesor
        </Link>
      </div>

      {!schoolId ? (
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5 text-sm text-gray-500 dark:text-gray-400">
          Cargando ruta de escuela…
        </div>
      ) : loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Cargando…</div>
      ) : teachers.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5 text-sm text-gray-500 dark:text-gray-400">
          No hay profesores aún.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teachers.map((t) => (
            <div
              key={t.id}
              className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-gray-900 dark:text-gray-100 truncate">
                    {t.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">
                    {t.subjects?.trim() ? t.subjects : "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/schools/${schoolId}/teachers/${t.id}`}
                    className="p-2 rounded-lg border border-gray-200 dark:border-zinc-800 hover:border-indigo-400 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </Link>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="p-2 rounded-lg border border-gray-200 dark:border-zinc-800 hover:border-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

