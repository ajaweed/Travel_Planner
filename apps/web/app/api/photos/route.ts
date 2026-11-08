import { NextRequest, NextResponse } from "next/server";
import { getDestinationPhotos } from "@trip-planner/core";

const MAX_PLACES = 12;
// Place names only: letters (any script), digits, spaces and light punctuation.
const PLACE = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’()&-]*$/u;

// GET /api/photos?place=Lisbon&place=Kyoto -> { photos: { [place]: DestinationPhoto | null } }
// Public, so lookups of new places are rate-capped (capped: true).
// Freely licensed Wikimedia Commons photos of the places, with credits. One
// batched lookup for all of them. A place maps to null (never an error) when
// there's no suitable photo: photos are decoration. New lookups are also
// rate-capped in core (getPlaceResults).
export async function GET(req: NextRequest) {
  const requested = [...new Set(req.nextUrl.searchParams.getAll("place").map((p) => p.trim()))].filter(Boolean);
  if (requested.length === 0 || requested.length > MAX_PLACES) {
    return NextResponse.json({ error: `1-${MAX_PLACES} place names required` }, { status: 400 });
  }
  // An odd name ("Sintra / Cascais") just gets no photo; it mustn't cost the
  // rest of a batched request theirs.
  const valid = requested.filter((p) => p.length <= 100 && PLACE.test(p));
  const photos = new Map<string, unknown>(requested.map((p) => [p, null]));
  for (const [place, photo] of await getDestinationPhotos(valid, { capped: true })) photos.set(place, photo);
  const anyMissing = [...photos.values()].some((p) => !p);
  return NextResponse.json(
    { photos: Object.fromEntries(photos) },
    // Misses get a short browser life so a busy Wikimedia doesn't stick.
    { headers: { "Cache-Control": `public, max-age=${anyMissing ? 600 : 86400}` } },
  );
}
