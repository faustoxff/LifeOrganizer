import "server-only";
import { NextResponse } from "next/server";
import { parseDraftBody } from "@/lib/project-input";
import { authenticate, badRequest, isPaid, planRequired, readBody, todayFor } from "@/lib/project-route";
import { previewDraft } from "@/lib/projects-service";
import { SchedulerError } from "@/lib/scheduler";
import { getUserPlan } from "@/lib/server-auth";

// POST /api/projects/preview — recomputes the plan for the subtasks the user edited.
// No AI: it is the scheduler only, so it does not spend any daily allowance.
export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  if (!isPaid(await getUserPlan(userId))) return planRequired();

  const body = await readBody(request);
  if (!body) return badRequest("Invalid request");

  const today = await todayFor(userId, body.tz);
  const draft = parseDraftBody(body, today);
  if (!draft.ok) return badRequest(draft.error);

  try {
    return NextResponse.json(await previewDraft(userId, today, draft.value));
  } catch (error) {
    if (error instanceof SchedulerError) return badRequest(error.message);
    console.error("previewDraft failed", error);
    return NextResponse.json({ error: "Failed to compute the plan" }, { status: 500 });
  }
}
