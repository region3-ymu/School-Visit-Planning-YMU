import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireUser, scopeToRegion } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getMileageReportData } from "@/lib/reports/mileageReport";
import { renderMileagePdf } from "@/lib/reports/renderMileagePdf";
import { renderMileageCsv } from "@/lib/reports/renderMileageCsv";

export async function GET(request: NextRequest) {
  const session = await auth();
  const user = requireUser(session);

  const { searchParams } = new URL(request.url);
  const schoolYear = searchParams.get("schoolYear");
  const quarterLabel = searchParams.get("quarter");
  const format = searchParams.get("format") ?? "csv";
  const regionIdParam = searchParams.get("regionId");

  if (!schoolYear || !quarterLabel) {
    return NextResponse.json({ error: "schoolYear and quarter are required" }, { status: 400 });
  }
  if (format !== "pdf" && format !== "csv") {
    return NextResponse.json({ error: "format must be pdf or csv" }, { status: 400 });
  }

  // Admins may pass regionId to scope the report; everyone else is
  // scoped to their own region (or unscoped if they have none).
  const regionId = user.role === "ADMIN" ? regionIdParam ?? undefined : scopeToRegion(user);

  try {
    const data = await getMileageReportData(prisma, { schoolYear, quarterLabel, regionId });
    const filenameBase = `mileage-${schoolYear}-${quarterLabel}`;

    if (format === "csv") {
      const csv = renderMileageCsv(data);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
        },
      });
    }

    const regionLabel = regionId
      ? (await prisma.region.findUnique({ where: { id: regionId }, select: { name: true } }))?.name
      : undefined;
    const buffer = await renderMileagePdf(data, regionLabel);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
      },
    });
  } catch (err) {
    console.error("mileage report error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
