import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@trip-planner/db";
import { startTrip } from "@trip-planner/core";

// NOTE: no real auth wired up yet (out of scope for this pass -- see
// docs/architecture.md). Every request plans a trip for a single demo user
// so the rest of the stack (orchestrator, DB, UI) has something real to run
// against. Swap this for session-based auth before this goes anywhere near
// real users/payments.
async function getOrCreateDemoUser() {
  return prisma.user.upsert({
    where: { email: "demo@trip-planner.local" },
    update: {},
    create: { email: "demo@trip-planner.local", name: "Demo User" },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "Missing 'prompt' string in request body." }, { status: 400 });
  }

  try {
    const user = await getOrCreateDemoUser();
    const result = await startTrip(user.id, body.prompt);
    return NextResponse.json({
      tripId: result.trip.id,
      needsClarification: result.needsClarification,
      question: result.needsClarification ? result.question : undefined,
    });
  } catch (err) {
    console.error("POST /api/plan failed", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
