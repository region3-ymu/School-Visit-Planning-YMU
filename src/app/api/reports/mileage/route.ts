import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireUser, scopeToRegion } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getMileageReportData } from "@/lib/reports/mileageReport";
import { resolveRange, type RangePreset } from "@/lib/reports/reportRange";
import { renderMileagePdf } from "@/lib/reports/renderMileagePdf";
import { renderMileageCsv } from "@/lib/reports/renderMileageCsv";

const VALID_PRESETS: RangePreset[] = ["week", "month", "quarter", "3months", "6months", "year", "custom"];

export async function GET(request: NextRequest) {
  const session = await auth();
  const user = requireUser(session);

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "csv";
  const regionIdParam = searchParams.get("regionId");
  const userIdParam = searchParams.get("userId");

  // The old links passed schoolYear+quarter with no preset; keep them working.
  const legacyQuarter =
    searchParams.get("schoolYear") && searchParams.get("quarter")
      ? `${searchParams.get("schoolYear")}|${searchParams.get("quarter")}`
      : null;
  const preset = (searchParams.get("preset") as RangePreset | null) ?? (legacyQuarter ? "quarter" : null);

  if (!preset || !VALID_PRESETS.includes(preset)) {
    return NextResponse.json(
      { error: `preset must be one of: ${VALID_PRESETS.join(", ")}` },
      { status: 400 }
    );
  }
  if (format !== "pdf" && format !== "csv") {
    return NextResponse.json({ error: "format must be pdf or csv" }, { status: 400 });
  }

  // Admins may scope to any region; everyone else is pinned to their own.
  const regionId = user.role === "ADMIN" ? regionIdParam ?? undefined : scopeToRegion(user);

  // Only ADMIN and REGIONAL_MANAGER may read someone else's mileage. Anyone else
  // asking for a specific RM is silently narrowed to themselves rather than
  // being handed another person's record.
  const canSeeOthers = user.role === "ADMIN" || user.role === "REGIONAL_MANAGER";
  const visitedById = canSeeOthers ? userIdParam ?? undefined : user.id;

  try {
    const range = await resolveRange(prisma, preset, {
      quarterKey: searchParams.get("quarterKey") ?? legacyQuarter,
      start: searchParams.get("start"),
      end: searchParams.get("end"),
    });

    const data = await getMileageReportData(prisma, {
      startDate: range.startDate,
      endDate: range.endDate,
      label: range.label,
      regionId,
      visitedById,
    });

    const slug = range.label.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const filenameBase = `mileage-${slug}`;

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
