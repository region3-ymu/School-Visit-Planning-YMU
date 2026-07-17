import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { geocodeAddress } from "@/lib/routing/openRouteClient";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const address = body?.address as string | undefined;

    if (!address?.trim()) {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }

    const result = await geocodeAddress(address.trim());
    return NextResponse.json(result);
  } catch (err) {
    console.error("geocode API error:", err);
    const message = err instanceof Error ? err.message : "Failed to geocode address";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
