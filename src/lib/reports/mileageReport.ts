import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/lib/decimal";

export type MileageReportData = {
  quarter: { schoolYear: string; label: string; startDate: Date; endDate: Date };
  totalMiles: number;
  byRM: { userId: string; userName: string; totalMiles: number; visitCount: number }[];
  bySchool: { schoolId: string; schoolName: string; regionName: string | null; totalMiles: number; visitCount: number }[];
  visits: {
    schoolName: string;
    regionName: string | null;
    visitedByName: string;
    date: Date;
    milesDriven: number;
  }[];
};

export async function getMileageReportData(
  prisma: PrismaClient,
  params: { schoolYear: string; quarterLabel: string; regionId?: string }
): Promise<MileageReportData> {
  const quarter = await prisma.quarter.findUnique({
    where: { schoolYear_label: { schoolYear: params.schoolYear, label: params.quarterLabel } },
  });
  if (!quarter) {
    throw new Error(`No Quarter found for ${params.schoolYear} ${params.quarterLabel}`);
  }

  const visits = await prisma.visit.findMany({
    where: {
      status: "DONE",
      milesDriven: { not: null },
      plannedStartDateTime: { gte: quarter.startDate, lte: quarter.endDate },
      ...(params.regionId ? { school: { regionId: params.regionId } } : {}),
    },
    include: {
      school: { select: { id: true, name: true, region: { select: { name: true } } } },
      visitedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { plannedStartDateTime: "asc" },
  });

  const byRMMap = new Map<string, { userId: string; userName: string; totalMiles: number; visitCount: number }>();
  const bySchoolMap = new Map<string, { schoolId: string; schoolName: string; regionName: string | null; totalMiles: number; visitCount: number }>();
  let totalMiles = 0;

  const reportVisits: MileageReportData["visits"] = [];

  for (const v of visits) {
    const miles = decimalToNumber(v.milesDriven) ?? 0;
    totalMiles += miles;

    const rmId = v.visitedById ?? "unknown";
    const rmName = v.visitedBy?.name ?? v.visitedBy?.email ?? "Unknown";
    const rmEntry = byRMMap.get(rmId) ?? { userId: rmId, userName: rmName, totalMiles: 0, visitCount: 0 };
    rmEntry.totalMiles += miles;
    rmEntry.visitCount += 1;
    byRMMap.set(rmId, rmEntry);

    const schoolEntry = bySchoolMap.get(v.schoolId) ?? {
      schoolId: v.schoolId,
      schoolName: v.school.name,
      regionName: v.school.region?.name ?? null,
      totalMiles: 0,
      visitCount: 0,
    };
    schoolEntry.totalMiles += miles;
    schoolEntry.visitCount += 1;
    bySchoolMap.set(v.schoolId, schoolEntry);

    reportVisits.push({
      schoolName: v.school.name,
      regionName: v.school.region?.name ?? null,
      visitedByName: rmName,
      date: v.plannedStartDateTime,
      milesDriven: miles,
    });
  }

  return {
    quarter: {
      schoolYear: quarter.schoolYear,
      label: quarter.label,
      startDate: quarter.startDate,
      endDate: quarter.endDate,
    },
    totalMiles,
    byRM: [...byRMMap.values()].sort((a, b) => b.totalMiles - a.totalMiles),
    bySchool: [...bySchoolMap.values()].sort((a, b) => b.totalMiles - a.totalMiles),
    visits: reportVisits,
  };
}
