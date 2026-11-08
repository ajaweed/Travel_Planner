import { NextRequest, NextResponse } from "next/server";
import { getDestinationPhoto } from "@trip-planner/core";

// GET /api/photos?place=Lisbon -> { photo: DestinationPhoto | null }
// Freely licensed Wikimedia Commons photo of the place, with its credit. Null
// (never an error) when there's no suitable photo: photos are decoration.
export async function GET(req: NextRequest) {
  const place = req.nextUrl.searchParams.get("place")?.trim() ?? "";
  if (!place || place.length > 100) {
    return NextResponse.json({ error: "place is required (max 100 characters)" }, { status: 400 });
  }
  const photo = await getDestinationPhoto(place);
  return NextResponse.json(
    { photo },
    // Browsers keep it a day; misses get a shorter life so a transient
    // Wikipedia failure doesn't stick.
    { headers: { "Cache-Control": `public, max-age=${photo ? 86400 : 600}` } },
  );
}
