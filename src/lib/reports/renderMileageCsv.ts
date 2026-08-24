import type { MileageReportData } from "./mileageReport";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Raw one-row-per-visit CSV, best for pivoting in Excel/Sheets. */
export function renderMileageCsv(data: MileageReportData): string {
  // Vehicle and Reimbursable are explicit columns so a pivot can't silently
  // fold van driving into a figure someone is about to be paid.
  const rows = [
    "School,Region,Regional Manager,Date,Mode,Vehicle,Miles To School,Return Miles,Total Miles,Reimbursable Miles",
  ];
  for (const v of data.visits) {
    rows.push(
      [
        csvEscape(v.schoolName),
        csvEscape(v.regionName ?? ""),
        csvEscape(v.visitedByName),
        v.date.toISOString().slice(0, 10),
        csvEscape(v.mode),
        csvEscape(v.vehicle === "YMU_VAN" ? "YMU Van" : "Personal"),
        v.milesDriven.toFixed(2),
        v.returnMiles.toFixed(2),
        (v.milesDriven + v.returnMiles).toFixed(2),
        v.vehicle === "YMU_VAN" ? "0.00" : (v.milesDriven + v.returnMiles).toFixed(2),
      ].join(",")
    );
  }
  return rows.join("\n") + "\n";
}
