"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Search, UserPlus } from "lucide-react";
import { getSchools } from "@/app/actions";

type School = { id: string; name: string };

type Candidate = {
  teacherId: string;
  teacherName: string;
  schoolId: string | null;
  schoolName: string | null;
  freeExact: boolean;
  subjectsMatch: boolean;
  score: number;
  availableStart: string;
  availableEnd: string;
  subjects: string | null;
  sameSchool?: boolean;
};

type SessionOption = {
  id: string;
  startDateTime: string; // ISO
  endDateTime: string; // ISO
  subjectId: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
};

function getErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Error";
}

function toISO(dateStr: string, timeStr: string): string {
  // Local time -> ISO
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return d.toISOString();
}

export default function SubstitutionsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState<string>("");
  const [dateStr, setDateStr] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Candidate[]>([]);

  useEffect(() => {
    getSchools().then((rows) => {
      const s = (rows as unknown as Array<{ id: string; name: string }>).map((r) => ({
        id: r.id,
        name: r.name,
      })) as School[];
      setSchools(s);
      if (!schoolId && s.length > 0) setSchoolId(s[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadSessions = async () => {
      if (!schoolId || !dateStr) {
        setSessions([]);
        setSelectedSessionId("");
        return;
      }
      try {
        const qs = new URLSearchParams({ schoolId, date: dateStr });
        const res = await fetch(`/api/class-sessions?${qs.toString()}`);
        const json: unknown = await res.json();
        if (!res.ok) {
          const msg =
            json && typeof json === "object" && "error" in json
              ? String((json as { error: unknown }).error)
              : "Failed to load sessions";
          throw new Error(msg);
        }
        const rows = json as SessionOption[];
        setSessions(rows);
        setSelectedSessionId(rows[0]?.id ?? "");
      } catch (e: unknown) {
        setSessions([]);
        setSelectedSessionId("");
      }
    };
    loadSessions();
  }, [schoolId, dateStr]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );
  const startIso = useMemo(() => selectedSession?.startDateTime ?? "", [selectedSession]);
  const endIso = useMemo(() => selectedSession?.endDateTime ?? "", [selectedSession]);
  const subject = useMemo(() => selectedSession?.subjectName ?? "", [selectedSession]);
  const excludeTeacherId = useMemo(() => selectedSession?.teacherId ?? "", [selectedSession]);

  const canSearch = Boolean(schoolId && selectedSessionId && startIso && endIso);

  const handleSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const qs = new URLSearchParams({
        schoolId,
        start: startIso,
        end: endIso,
        subject: subject.trim(),
        ...(excludeTeacherId ? { excludeTeacherId } : {}),
      });
      const res = await fetch(`/api/substitutions?${qs.toString()}`, { method: "GET" });
      const json: unknown = await res.json();
      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : "Failed to search";
        throw new Error(msg);
      }
      setResults(json as Candidate[]);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (teacherId: string) => {
    setAssigningId(teacherId);
    setError(null);
    try {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          teacherId,
          start: startIso,
          end: endIso,
          subject: subject.trim(),
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        const msg =
          json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : "Failed to assign";
        throw new Error(msg);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setAssigningId(null);
    }
  };

  const selectedSchoolName = useMemo(
    () => schools.find((s) => s.id === schoolId)?.name ?? "",
    [schools, schoolId]
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-gray-100">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarDays size={18} className="text-indigo-600 dark:text-indigo-400" />
              Sustitutos
            </h1>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Buscar profesores libres en un hueco exacto.
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Escuela</label>
              <select
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {selectedSchoolName && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                  Preferencia: {selectedSchoolName}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Fecha</label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Clase a sustituir</label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
              >
                {sessions.length === 0 ? (
                  <option value="">No hay clases ese día</option>
                ) : (
                  sessions.map((s) => {
                    const start = new Date(s.startDateTime);
                    const end = new Date(s.endDateTime);
                    const label = `${format(start, "HH:mm")}-${format(end, "HH:mm")} • ${s.subjectName}${s.teacherName ? ` • ${s.teacherName}` : ""}`;
                    return (
                      <option key={s.id} value={s.id}>
                        {label}
                      </option>
                    );
                  })
                )}
              </select>
              {selectedSession?.teacherName && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Profesor encargado: <span className="font-semibold">{selectedSession.teacherName}</span> (se excluye)
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-4 items-end">
            <div className="md:col-span-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Materia seleccionada: <span className="font-semibold">{subject || "—"}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                La materia ya viene del calendario. Se usa para priorizar, no para filtrar.
              </div>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button
                onClick={handleSearch}
                disabled={!canSearch || loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold"
              >
                <Search size={16} />
                {loading ? "Buscando…" : "Buscar libres"}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 rounded-lg p-3">
              {error}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-zinc-800 font-semibold">
            Resultados ({results.length})
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="text-left px-4 py-3">Nombre</th>
                  <th className="text-left px-4 py-3">Disponible</th>
                  <th className="text-left px-4 py-3">Materia</th>
                  <th className="text-left px-4 py-3">Escuela</th>
                  <th className="text-right px-4 py-3">Acción</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-gray-500 dark:text-gray-400" colSpan={5}>
                      {loading ? "Buscando…" : "Sin resultados todavía."}
                    </td>
                  </tr>
                ) : (
                  results.map((c) => (
                    <tr key={c.teacherId} className="border-t border-gray-100 dark:border-zinc-800">
                      <td className="px-4 py-3 font-semibold">{c.teacherName}</td>
                      <td className="px-4 py-3">
                        {selectedSession
                          ? `${format(new Date(selectedSession.startDateTime), "HH:mm")}–${format(new Date(selectedSession.endDateTime), "HH:mm")}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {subject.trim() ? (
                          <span className={c.subjectsMatch ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
                            {subject.trim()} {c.subjectsMatch ? "✓" : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.schoolName ?? "—"}
                        {c.sameSchool ? (
                          <span className="ml-2 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                            cerca
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleAssign(c.teacherId)}
                          disabled={assigningId === c.teacherId}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-zinc-800 hover:border-indigo-400 disabled:opacity-50"
                        >
                          <UserPlus size={16} />
                          {assigningId === c.teacherId ? "Asignando…" : "Asignar"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-gray-100 dark:border-zinc-800 text-xs text-gray-500 dark:text-gray-400">
            Orden: libre exacto (100) + misma escuela (50) + materia coincide (30).
          </div>
        </div>
      </div>
    </div>
  );
}

