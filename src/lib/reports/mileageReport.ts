import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/lib/decimal";

export type MileageReportData = {
  /** Human-readable name of the window, e.g. "2026-27 Q2" or "Aug 2026". */
  period: { label: string; startDate: Date; endDate: Date };
  /** Own-car miles after the commute deduction — the payable figure. */
  totalMiles: number;
  /** Everything actually driven in an own car, before the deduction. */
  drivenMiles: number;
  /** First and last legs of each day, which the IRS rule leaves unpaid. */
  commuteMiles: number;
  /** Driven in the YMU van. Recorded for the vehicle, owed to nobody. */
  vanMiles: number;
  vanVisitCount: number;
  /**
   * Visits made by phone or video. No miles by definition, so they never touch
   * the mileage figures — but they are work done, and a month of them would
   * otherwise read as a month of nothing.
   */
  onlineVisitCount: number;
  phoneVisitCount: number;
  byRM: {
    userId: string;
    userName: string;
    totalMiles: number;
    commuteMiles: number;
    visitCount: number;
    vanMiles: number;
  }[];
  bySchool: { schoolId: string; schoolName: string; regionName: string | null; totalMiles: number; visitCount: number }[];
  visits: {
    schoolName: string;
    regionName: string | null;
    visitedByName: string;
    date: Date;
    milesDriven: number;
    returnMiles: number;
    commuteMiles: number;
    reimbursableMiles: number;
    mode: string;
    vehicle: string;
  }[];
  /**
   * In-person visits in this window that were driven to but never measured —
   * the routing service failed at confirm time, or no starting point was on
   * file. They are NOT in `visits` and contribute nothing to any total: an
   * unmeasured trip has no honest number to add, and inventing one would make
   * it indistinguishable from a real measurement on a reimbursement.
   *
   * They are reported here so the report can say so out loud. Dropping them
   * from the query and saying nothing is what let a drive disappear between
   * confirming a visit and being paid for it.
   */
  unmeasured: {
    schoolName: string;
    visitedByName: string;
    date: Date;
  }[];
};

export type MileageReportParams = {
  startDate: Date;
  endDate: Date;
  label: string;
  /**
   * The region whose *drivers* this report covers — not whose schools.
   *
   * A reimbursement is owed to a person for the miles they drove, wherever they
   * drove them. Scoping on the school's region lost every mile an RM put in
   * outside their own patch: a Central RM at Edison Park, which is East, and
   * every stop at the office, which belongs to no region at all.
   */
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
      // Remote visits carry no mileage by design, so they are let in
      // deliberately rather than swept up with the unmeasured ones — counted,
      // never priced. Anything else with no legs measured is left out.
      OR: [
        { milesDriven: { not: null } },
        { returnMilesDriven: { not: null } },
        { mode: { in: ["ONLINE", "PHONE"] } },
      ],
      plannedStartDateTime: { gte: params.startDate, lte: params.endDate },
      // By who drove, not by whose school. See regionId above.
      ...(params.regionId ? { visitedBy: { regionId: params.regionId } } : {}),
      ...(params.visitedById ? { visitedById: params.visitedById } : {}),
    },
    include: {
      school: { select: { id: true, name: true, region: { select: { name: true } } } },
      visitedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { plannedStartDateTime: "asc" },
  });

  // Same window and the same scoping as above, but the rows the filter there
  // deliberately excludes: driven, and never measured.
  const unmeasuredVisits = await prisma.visit.findMany({
    where: {
      status: "DONE",
      mode: "IN_PERSON",
      milesDriven: null,
      returnMilesDriven: null,
      plannedStartDateTime: { gte: params.startDate, lte: params.endDate },
      ...(params.regionId ? { visitedBy: { regionId: params.regionId } } : {}),
      ...(params.visitedById ? { visitedById: params.visitedById } : {}),
    },
    include: {
      school: { select: { name: true } },
      visitedBy: { select: { name: true, email: true } },
    },
    orderBy: { plannedStartDateTime: "asc" },
  });

  const byRMMap = new Map<string, MileageReportData["byRM"][number]>();
  const bySchoolMap = new Map<string, MileageReportData["bySchool"][number]>();
  let drivenMiles = 0;
  let commuteMiles = 0;
  let vanMiles = 0;
  let vanVisitCount = 0;
  let onlineVisitCount = 0;
  let phoneVisitCount = 0;

  const reportVisits: MileageReportData["visits"] = [];

  for (const v of visits) {
    const outbound = decimalToNumber(v.milesDriven) ?? 0;
    const back = decimalToNumber(v.returnMilesDriven) ?? 0;
    // The drive home is booked on the day's last visit, so it rolls up under the
    // same RM and school as that visit's outbound leg.
    if (v.mode === "ONLINE") onlineVisitCount += 1;
    if (v.mode === "PHONE") phoneVisitCount += 1;

    const miles = outbound + back;
    // Home at one end: the day's opening and closing legs, unpaid under the
    // IRS rule even though they were genuinely driven.
    const commute =
      (decimalToNumber(v.commuteMiles) ?? 0) + (decimalToNumber(v.returnCommuteMiles) ?? 0);

    // Van driving is YMU's own fuel, so it is tracked apart and never reaches
    // the totals a reimbursement is calculated from.
    const isVan = v.vehicle === "YMU_VAN";
    if (isVan) {
      vanMiles += miles;
      vanVisitCount += 1;
    } else {
      drivenMiles += miles;
      commuteMiles += commute;
    }
    const reimbursable = isVan ? 0 : Math.max(0, miles - commute);

    const rmId = v.visitedById ?? "unknown";
    const rmName = v.visitedBy?.name ?? v.visitedBy?.email ?? "Unknown";
    const rmEntry =
      byRMMap.get(rmId) ??
      { userId: rmId, userName: rmName, totalMiles: 0, commuteMiles: 0, visitCount: 0, vanMiles: 0 };
    if (isVan) {
      rmEntry.vanMiles += miles;
    } else {
      rmEntry.totalMiles += reimbursable;
      rmEntry.commuteMiles += commute;
    }
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
      commuteMiles: commute,
      reimbursableMiles: reimbursable,
      mode: v.mode,
      vehicle: v.vehicle,
    });
  }

  return {
    unmeasured: unmeasuredVisits.map((v) => ({
      schoolName: v.school.name,
      visitedByName: v.visitedBy?.name ?? v.visitedBy?.email ?? "Unknown",
      date: v.plannedStartDateTime,
    })),
    period: { label: params.label, startDate: params.startDate, endDate: params.endDate },
    totalMiles: Math.max(0, drivenMiles - commuteMiles),
    drivenMiles,
    commuteMiles,
    vanMiles,
    vanVisitCount,
    onlineVisitCount,
    phoneVisitCount,
    byRM: [...byRMMap.values()].sort((a, b) => b.totalMiles - a.totalMiles),
    bySchool: [...bySchoolMap.values()].sort((a, b) => b.totalMiles - a.totalMiles),
    visits: reportVisits,
  };
}
