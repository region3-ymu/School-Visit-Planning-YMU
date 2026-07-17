"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createTeacher } from "@/app/actions";

function getErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Failed to save teacher";
}

export default function NewTeacherPage() {
  const params = useParams<{ id: string }>();
  const schoolId = params?.id;
  const router = useRouter();
  const [name, setName] = useState("");
  const [subjects, setSubjects] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!schoolId) return;
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createTeacher(schoolId, { name: name.trim(), subjects });
      router.replace(`/schools/${schoolId}/teachers`);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Agregar profesor</h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Nombre y materias (texto libre).
          </div>
        </div>
        <Link
          href={schoolId ? `/schools/${schoolId}/teachers` : "/"}
          className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Cancel
        </Link>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5 space-y-4">
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 rounded-lg p-3">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-semibold mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
            placeholder="e.g. Ms. Jane Doe"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Subjects</label>
          <textarea
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 min-h-[140px] font-mono text-sm"
            placeholder={"e.g.\nModern Band\nDrumline"}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !schoolId}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link
            href={`/schools/${schoolId}/teachers`}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 text-sm font-semibold"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}

