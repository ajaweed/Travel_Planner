import { NextRequest, NextResponse } from "next/server";
import { getDestinationPhotos } from "@trip-planner/core";

const MAX_PLACES = 12;
// Place names only: letters (any script), digits, spaces and light punctuation.
const PLACE = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’()&-]*$/u;

// GET /api/photos?place=Lisbon&place=Kyoto -> { photos: { [place]: DestinationPhoto | null } }
// Freely licensed Wikimedia Commons photos of the places, with credits. One
// batched lookup for all of them. A place maps to null (never an error) when
// there's no suitable photo: photos are decoration. New lookups are also
// rate-capped in core (getPlaceResults).
export async function GET(req: NextRequest) {
  const places = [...new Set(req.nextUrl.searchParams.getAll("place").map((p) => p.trim()))];
  if (places.length === 0 || places.length > MAX_PLACES || places.some((p) => p.length > 100 || !PLACE.test(p))) {
    return NextResponse.json(
      { error: `1-${MAX_PLACES} place names required (max 100 characters each)` },
      { status: 400 },
    );
  }
  const photos = await getDestinationPhotos(places);
  const anyMissing = [...photos.values()].some((p) => !p);
  return NextResponse.json(
    { photos: Object.fromEntries(photos) },
    // Misses get a short browser life so a busy Wikimedia doesn't stick.
    { headers: { "Cache-Control": `public, max-age=${anyMissing ? 600 : 86400}` } },
  );
}
