import { NextRequest, NextResponse } from "next/server";
import { OrchestratorError, selectItineraryOption } from "@trip-planner/core";

// Maps the orchestrator's flow failures onto distinct statuses so the UI can
// say something specific -- a second click on "choose this plan" is a 409
// ("already chosen"), not a generic 500.
const STATUS_BY_CODE: Record<string, number> = {
  OPTION_NOT_FOUND: 404,
  OPTION_ALREADY_CHOSEN: 409,
  TRIP_PAST_PLANNING: 409,
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.optionId || typeof body.optionId !== "string") {
    return NextResponse.json(
      { error: "Missing 'optionId' string in request body." },
      { status: 400 },
    );
  }

  // Default to SELF: an absent or unrecognised mode must never opt someone
  // into the AI spending their money.
  const mode = body.bookingMode === "AI" ? "AI" : "SELF";

  try {
    // SELF: locks in the plan (-> READY_TO_BOOK) with link-out bookings; fast.
    // AI: locks in the plan (-> BOOKING) and runs the full booking pass before
    // returning. The status flips immediately, so the dashboard's poll shows
    // per-item progress while this request is still in flight.
    await selectItineraryOption(params.id, body.optionId, mode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: STATUS_BY_CODE[err.code] ?? 400 },
      );
    }
    console.error(`POST /api/trips/${params.id}/choose failed`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
