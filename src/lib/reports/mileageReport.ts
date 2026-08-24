import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/lib/decimal";

export type MileageReportData = {
  /** Human-readable name of the window, e.g. "2026-27 Q2" or "Aug 2026". */
  period: { label: string; startDate: Date; endDate: Date };
  /** Own-car miles only — the reimbursable figure. */
  totalMiles: number;
  outboundMiles: number;
  returnMiles: number;
  /** Driven in the YMU van. Recorded for the vehicle, owed to nobody. */
  vanMiles: number;
  vanVisitCount: number;
  byRM: { userId: string; userName: string; totalMiles: number; visitCount: number; vanMiles: number }[];
  bySchool: { schoolId: string; schoolName: string; regionName: string | null; totalMiles: number; visitCount: number }[];
  visits: {
    schoolName: string;
    regionName: string | null;
    visitedByName: string;
    date: Date;
    milesDriven: number;
    returnMiles: number;
    mode: string;
    vehicle: string;
  }[];
};

export type MileageReportParams = {
  startDate: Date;
  endDate: Date;
  label: string;
  regionId?: string;
  /** Narrow the report to a single regional manager. */
  visitedById?: string;
};

export async function getMileageReportData(
  prisma: PrismaClient,
  params: MileageReportParams
): Promise<MileageReportData> {
  const visits = await prisma.visit.findMany({
    where: {
      status: "DONE",
      // A visit with neither leg measured contributes no miles but would still
      // inflate the visit counts below.
      OR: [{ milesDriven: { not: null } }, { returnMilesDriven: { not: null } }],
      plannedStartDateTime: { gte: params.startDate, lte: params.endDate },
      ...(params.regionId ? { school: { regionId: params.regionId } } : {}),
      ...(params.visitedById ? { visitedById: params.visitedById } : {}),
    },
    include: {
      school: { select: { id: true, name: true, region: { select: { name: true } } } },
      visitedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { plannedStartDateTime: "asc" },
  });

  const byRMMap = new Map<string, MileageReportData["byRM"][number]>();
  const bySchoolMap = new Map<string, MileageReportData["bySchool"][number]>();
  let outboundMiles = 0;
  let returnMiles = 0;
  let vanMiles = 0;
  let vanVisitCount = 0;

  const reportVisits: MileageReportData["visits"] = [];

  for (const v of visits) {
    const outbound = decimalToNumber(v.milesDriven) ?? 0;
    const back = decimalToNumber(v.returnMilesDriven) ?? 0;
    // The drive home is booked on the day's last visit, so it rolls up under the
    // same RM and school as that visit's outbound leg.
    const miles = outbound + back;

    // Van driving is YMU's own fuel, so it is tracked apart and never reaches
    // the totals a reimbursement is calculated from.
    const isVan = v.vehicle === "YMU_VAN";
    if (isVan) {
      vanMiles += miles;
      vanVisitCount += 1;
    } else {
      outboundMiles += outbound;
      returnMiles += back;
    }

    const rmId = v.visitedById ?? "unknown";
    const rmName = v.visitedBy?.name ?? v.visitedBy?.email ?? "Unknown";
    const rmEntry = byRMMap.get(rmId) ?? { userId: rmId, userName: rmName, totalMiles: 0, visitCount: 0, vanMiles: 0 };
    if (isVan) rmEntry.vanMiles += miles;
    else rmEntry.totalMiles += miles;
    rmEntry.visitCount += 1;
    byRMMap.set(rmId, rmEntry);

    const schoolEntry = bySchoolMap.get(v.schoolId) ?? {
      schoolId: v.schoolId,
      schoolName: v.school.name,
      regionName: v.school.region?.name ?? null,
      totalMiles: 0,
      visitCount: 0,
    };
    // Per-school stays whole-trip: the question there is how much driving a
    // school generates, not who pays for it.
    schoolEntry.totalMiles += miles;
    schoolEntry.visitCount += 1;
    bySchoolMap.set(v.schoolId, schoolEntry);

    reportVisits.push({
      schoolName: v.school.name,
      regionName: v.school.region?.name ?? null,
      visitedByName: rmName,
      date: v.plannedStartDateTime,
      milesDriven: outbound,
      returnMiles: back,
      mode: v.mode,
      vehicle: v.vehicle,
    });
  }

  return {
    period: { label: params.label, startDate: params.startDate, endDate: params.endDate },
    totalMiles: outboundMiles + returnMiles,
    outboundMiles,
    returnMiles,
    vanMiles,
    vanVisitCount,
    byRM: [...byRMMap.values()].sort((a, b) => b.totalMiles - a.totalMiles),
    bySchool: [...bySchoolMap.values()].sort((a, b) => b.totalMiles - a.totalMiles),
    visits: reportVisits,
  };
}
