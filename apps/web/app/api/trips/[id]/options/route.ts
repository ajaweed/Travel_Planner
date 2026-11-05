import { NextRequest, NextResponse } from "next/server";
import { listItineraryOptions } from "@trip-planner/core";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const options = await listItineraryOptions(params.id);
    return NextResponse.json({ options });
  } catch (err) {
    console.error(`GET /api/trips/${params.id}/options failed`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
