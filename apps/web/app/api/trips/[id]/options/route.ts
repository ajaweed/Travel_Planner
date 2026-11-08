import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import { buildResearchLinks, destinationFor, listItineraryOptions } from "@trip-planner/core";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [options, trip] = await Promise.all([
      listItineraryOptions(params.id),
      prisma.trip.findUnique({ where: { id: params.id }, select: { briefJson: true } }),
    ]);
    const destinations = safeDestinations(trip?.briefJson);

    // Named hotels/tours get "see what people say" links (Google / Reddit) so
    // the traveller can vet them before choosing. Deterministic URLs only.
    const withResearch = options.map((option) => ({
      ...option,
      draft: {
        ...option.draft,
        days: option.draft.days.map((day) => ({
          ...day,
          activities: day.activities.map((activity) =>
            activity.bookable?.candidateName
              ? {
                  ...activity,
                  bookable: {
                    ...activity.bookable,
                    research: buildResearchLinks({
                      title: activity.title,
                      candidateName: activity.bookable.candidateName,
                      destination: destinationFor(
                        destinations,
                        activity.bookable.candidateName,
                        activity.title,
                        activity.bookable.searchHint,
                      ),
                      kind: activity.bookable.kind,
                    }),
                  },
                }
              : activity,
          ),
        })),
      },
    }));

    return NextResponse.json({ options: withResearch });
  } catch (err) {
    console.error(`GET /api/trips/${params.id}/options failed`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function safeDestinations(briefJson: string | undefined): string[] {
  if (!briefJson) return [];
  try {
    const d = JSON.parse(briefJson)?.destinations;
    return Array.isArray(d) ? d.filter((x: unknown): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
