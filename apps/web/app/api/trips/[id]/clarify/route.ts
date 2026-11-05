import { NextRequest, NextResponse } from "next/server";
import { answerClarification } from "@trip-planner/core";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.answer || typeof body.answer !== "string") {
    return NextResponse.json({ error: "Missing 'answer' string in request body." }, { status: 400 });
  }

  try {
    const result = await answerClarification(params.id, body.answer);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`POST /api/trips/${params.id}/clarify failed`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
