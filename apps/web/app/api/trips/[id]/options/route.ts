import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import {
  buildResearchLinks,
  destinationFor,
  destinationsFromBrief,
  listItineraryOptions,
} from "@trip-planner/core";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [options, trip] = await Promise.all([
      listItineraryOptions(params.id),
      prisma.trip.findUnique({ where: { id: params.id }, select: { briefJson: true } }),
    ]);
    const destinations = destinationsFromBrief(trip?.briefJson);

    // Named hotels/tours (the places the cards list) get "see what people say"
    // links so the traveller can vet them before choosing. Only those items
    // are touched; everything else passes through by reference.
    for (const option of options) {
      for (const day of option.draft.days) {
        day.activities = day.activities.map((activity) => {
          const b = activity.bookable;
          if (!b?.candidateName || (b.kind !== "HOTEL" && b.kind !== "TOUR")) return activity;
          // Search the name the card SHOWS: the reviews provider's resolved
          // name when there is one, else the agent's candidate.
          const shownName = b.review?.name ?? b.candidateName;
          return {
            ...activity,
            bookable: {
              ...b,
              research: buildResearchLinks({
                title: activity.title,
                candidateName: shownName,
                destination: destinationFor(destinations, b.candidateName, activity.title, b.searchHint),
                kind: b.kind,
              }),
            },
          };
        });
      }
    }

    return NextResponse.json({ options });
  } catch (err) {
    console.error(`GET /api/trips/${params.id}/options failed`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
