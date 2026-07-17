import type { MileageReportData } from "./mileageReport";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Raw one-row-per-visit CSV, best for pivoting in Excel/Sheets. */
export function renderMileageCsv(data: MileageReportData): string {
  const rows = ["School,Region,Regional Manager,Date,Miles Driven"];
  for (const v of data.visits) {
    rows.push(
      [
        csvEscape(v.schoolName),
        csvEscape(v.regionName ?? ""),
        csvEscape(v.visitedByName),
        v.date.toISOString().slice(0, 10),
        v.milesDriven.toFixed(2),
      ].join(",")
    );
  }
  return rows.join("\n") + "\n";
}
