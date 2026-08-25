"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { BarChart3, Download, Loader2, Car, AlertTriangle } from "lucide-react";
import { getMileageReport, getReportableUsers, getQuarters } from "@/app/actions";
import { RANGE_PRESETS, type RangePreset } from "@/lib/reports/reportRange";

type ReportData = Awaited<ReturnType<typeof getMileageReport>>;
type ReportableUser = Awaited<ReturnType<typeof getReportableUsers>>[number];

export default function MileageReports({ regionFilter }: { regionFilter?: string | null }) {
  const [preset, setPreset] = useState<RangePreset>("month");
  const [quarters, setQuarters] = useState<{ id: string; schoolYear: string; label: string }[]>([]);
  const [quarterKey, setQuarterKey] = useState("");
  const [customStart, setCustomStart] = useState(format(new Date(), "yyyy-MM-01"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const [users, setUsers] = useState<ReportableUser[]>([]);
  const [userId, setUserId] = useState("");
  const [reportFormat, setReportFormat] = useState<"csv" | "pdf">("csv");

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReportableUsers().then(setUsers);
    getQuarters().then((q) => {
      setQuarters(q);
      if (q.length > 0) setQuarterKey(`${q[0].schoolYear}|${q[0].label}`);
    });
  }, []);

  const load = useCallback(async () => {
    // The quarter preset can't run until the quarter list has arrived.
    if (preset === "quarter" && !quarterKey) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await getMileageReport({
          preset,
          quarterKey: preset === "quarter" ? quarterKey : null,
          start: preset === "custom" ? customStart : null,
          end: preset === "custom" ? customEnd : null,
          regionId: regionFilter ?? null,
          userId: userId || null,
        })
      );
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Could not build the report");
    } finally {
      setLoading(false);
    }
  }, [preset, quarterKey, customStart, customEnd, regionFilter, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadUrl = (() => {
    const params = new URLSearchParams({ preset, format: reportFormat });
    if (preset === "quarter" && quarterKey) params.set("quarterKey", quarterKey);
    if (preset === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    if (regionFilter) params.set("regionId", regionFilter);
    if (userId) params.set("userId", userId);
    return `/api/reports/mileage?${params.toString()}`;
  })();

  const selectClass =
    "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center">
          <BarChart3 className="mr-2 text-indigo-600 dark:text-indigo-400" />
          Mileage Reports
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Miles driven per regional manager and school, over any period.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3">
        <select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} className={selectClass}>
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {preset === "quarter" && quarters.length > 0 && (
          <select value={quarterKey} onChange={(e) => setQuarterKey(e.target.value)} className={selectClass}>
            {quarters.map((q) => (
              <option key={q.id} value={`${q.schoolYear}|${q.label}`}>
                {q.schoolYear} {q.label}
              </option>
            ))}
          </select>
        )}

        {preset === "custom" && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className={selectClass} />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className={selectClass} />
          </>
        )}

        {users.length > 1 && (
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={selectClass}>
            <option value="">All regional managers</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <select value={reportFormat} onChange={(e) => setReportFormat(e.target.value as "csv" | "pdf")} className={selectClass}>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
          <a
            href={downloadUrl}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Download size={16} />
            <span>Download</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4 mb-6 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Building report…
        </div>
      ) : data ? (
        <>
          {/* Reimbursable is the headline because it is the only figure anyone
              acts on. The other two cards say what was taken off it and why:
              the commute at each end of the day, and the van. */}
          <div className={`grid grid-cols-1 gap-4 mb-6 ${data.vanMiles > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <SummaryCard label="Reimbursable miles" value={data.totalMiles.toFixed(1)} highlight />
            <SummaryCard label="Total driven" value={data.drivenMiles.toFixed(1)} />
            <SummaryCard label="Commute (not paid)" value={data.commuteMiles.toFixed(1)} />
            {data.vanMiles > 0 && <SummaryCard label="YMU van (not owed)" value={data.vanMiles.toFixed(1)} />}
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {data.period.label} · {data.visits.length} visit{data.visits.length === 1 ? "" : "s"}
            {data.vanVisitCount > 0 && `, ${data.vanVisitCount} in the van`}
            {(data.onlineVisitCount > 0 || data.phoneVisitCount > 0) && (
              <>
                {" · "}
                {[
                  data.onlineVisitCount > 0 && `${data.onlineVisitCount} online`,
                  data.phoneVisitCount > 0 && `${data.phoneVisitCount} by phone`,
                ]
                  .filter(Boolean)
                  .join(" and ")}
                {" (no driving)"}
              </>
            )}
          </p>

          {/* Said on the report itself, not only in the app-wide banner: this
              is the document someone reconciles a payment against, and a total
              that quietly excludes real driving is worse than one that admits
              what it could not measure. */}
          {data.unmeasured.length > 0 && (
            <div className="mb-6 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-4">
              <p className="flex items-center gap-2 text-sm font-black text-red-700 dark:text-red-300">
                <AlertTriangle size={18} />
                {data.unmeasured.length} in-person visit
                {data.unmeasured.length === 1 ? "" : "s"} in this period {data.unmeasured.length === 1 ? "is" : "are"} missing from the
                figures above
              </p>
              <p className="mt-1 text-xs text-red-700/90 dark:text-red-300/90">
                The distance was never measured for {data.unmeasured.length === 1 ? "it" : "them"}, so
                the miles driven are not counted anywhere on this report. Use{" "}
                <span className="font-semibold">Recalculate</span> on the red banner to recover
                {data.unmeasured.length === 1 ? " it" : " them"}.
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-red-800 dark:text-red-200">
                {data.unmeasured.map((u, i) => (
                  <li key={i}>
                    {format(new Date(u.date), "d MMM yyyy")} — {u.schoolName} ({u.visitedByName})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ReportTable
            title="By Regional Manager"
            headers={["Regional Manager", "Visits", "Reimbursable", "Commute", "Van"]}
            rows={data.byRM.map((r) => [
              r.userName,
              String(r.visitCount),
              r.totalMiles.toFixed(1),
              r.commuteMiles > 0 ? r.commuteMiles.toFixed(1) : "—",
              r.vanMiles > 0 ? r.vanMiles.toFixed(1) : "—",
            ])}
          />

          <ReportTable
            title="By School"
            headers={["School", "Region", "Visits", "All Miles"]}
            rows={data.bySchool.map((r) => [
              r.schoolName,
              r.regionName ?? "—",
              String(r.visitCount),
              r.totalMiles.toFixed(1),
            ])}
          />
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30"
          : "border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900"
      }`}
    >
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
        <Car size={12} /> {label}
      </p>
      <p
        className={`text-2xl font-bold mt-1 ${
          highlight ? "text-indigo-700 dark:text-indigo-300" : "text-gray-800 dark:text-gray-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{title}</h3>
      <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-600 dark:text-gray-300">
              <tr>
                {headers.map((h, i) => (
                  <th key={h} className={`px-6 py-3 font-semibold ${i > 0 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-6 py-8 text-center text-gray-500">
                    No mileage recorded for this period.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-6 py-3 ${
                          j === 0
                            ? "font-medium text-gray-900 dark:text-white"
                            : "text-right text-gray-600 dark:text-gray-400"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
