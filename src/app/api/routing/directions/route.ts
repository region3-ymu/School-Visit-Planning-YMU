import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDrivingPolyline } from "@/lib/routing/openRouteClient";
import type { LatLng } from "@/lib/routing/types";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const waypoints = body?.waypoints as LatLng[] | undefined;

    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return NextResponse.json(
        { error: "waypoints must be an array of at least 2 {lat, lng} points" },
        { status: 400 }
      );
    }

    for (const p of waypoints) {
      if (typeof p.lat !== "number" || typeof p.lng !== "number") {
        return NextResponse.json(
          { error: "Each waypoint must have numeric lat and lng" },
          { status: 400 }
        );
      }
    }

    const polyline = await getDrivingPolyline(waypoints);
    return NextResponse.json({ polyline });
  } catch (err) {
    console.error("directions API error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch directions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
