import "server-only";
import { NextResponse } from "next/server";
import { authenticate, badRequest, readBody, todayFor } from "@/lib/project-route";
import { applySubtaskAction } from "@/lib/projects-service";

// PATCH /api/projects/subtasks — { subtaskId, action, actualMin?, minutes? }
//   complete: the subtask is done; actualMin (optional) is the time of this last stretch
//   progress: "I did this part": adds minutes without finishing it
//   skip:     defer it to tomorrow
// Every action replans the user's projects. Deterministic, no AI: not gated by plan, so a
// user who downgraded can still move what they already have.
export async function PATCH(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const body = await readBody(request);
  if (!body || typeof body.subtaskId !== "string" || body.subtaskId.length > 100) return badRequest("Invalid request");

  const minutes = (value: unknown, allowNull: boolean): number | null | undefined => {
    if (value === undefined || value === null) return allowNull ? null : undefined;
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1440 ? value : undefined;
  };

  let action: Parameters<typeof applySubtaskAction>[3];
  if (body.action === "complete") {
    const actual = minutes(body.actualMin, true);
    if (actual === undefined) return badRequest("Invalid actualMin");
    action = { action: "complete", actualMin: actual };
  } else if (body.action === "progress") {
    const m = minutes(body.minutes, false);
    if (m === undefined || m === null) return badRequest("Invalid minutes");
    action = { action: "progress", minutes: m };
  } else if (body.action === "skip") {
    action = { action: "skip" };
  } else {
    return badRequest("Invalid action");
  }

  try {
    const today = await todayFor(userId, body.tz);
    const result = await applySubtaskAction(userId, today, body.subtaskId, action);
    if (!result) return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
    return NextResponse.json({ projects: result.views, projectDone: result.projectDone });
  } catch (error) {
    console.error("applySubtaskAction failed", error);
    return NextResponse.json({ error: "Failed to update the subtask" }, { status: 500 });
  }
}
