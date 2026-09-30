import "server-only";
import { NextResponse } from "next/server";
import { parseDraftBody } from "@/lib/project-input";
import { authenticate, badRequest, isPaid, planRequired, readBody, todayFor } from "@/lib/project-route";
import { addDailyMinutes, createFromDraft, listProjects, moveDeadline, ProjectLimitError } from "@/lib/projects-service";
import { ensureDailyReplan } from "@/lib/replan";
import { isDateKey } from "@/lib/recurrence";
import { SchedulerError } from "@/lib/scheduler";
import { getUserPlan } from "@/lib/server-auth";
import { countUserTasks } from "@/lib/storage";
import { MAX_TASKS_PER_USER } from "@/lib/usage-limits";

// GET /api/projects?tz= — the user's projects with their agenda and how the plan is
// doing. The first call of the day replans (once per user per day, idempotent). Reading
// is open to every plan: a user who downgraded still sees, and can advance, what exists.
export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  try {
    const today = await todayFor(userId, new URL(request.url).searchParams.get("tz"));
    // Una vez por día, para todo (tareas y proyectos). Un fallo acá no debe impedir ver los proyectos.
    await ensureDailyReplan(userId, today).catch((error) => console.error("ensureDailyReplan failed", error));
    return NextResponse.json({ projects: await listProjects(userId, today) });
  } catch (error) {
    console.error("listProjects failed", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}

// POST /api/projects — confirm a draft. The server recomputes the plan itself: the
// client's sessions are never trusted. Plus/Pro only.
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

  if ((await countUserTasks(userId)) >= MAX_TASKS_PER_USER) {
    return NextResponse.json({ error: "TASK_LIMIT_REACHED", limit: MAX_TASKS_PER_USER }, { status: 403 });
  }

  try {
    return NextResponse.json({ projects: await createFromDraft(userId, today, draft.value) });
  } catch (error) {
    if (error instanceof ProjectLimitError) {
      return NextResponse.json({ error: "PROJECT_LIMIT_REACHED", limit: error.limit }, { status: 403 });
    }
    if (error instanceof SchedulerError) return badRequest(error.message);
    console.error("createFromDraft failed", error);
    return NextResponse.json({ error: "Failed to create the project" }, { status: 500 });
  }
}

// PATCH /api/projects — the concrete fixes offered when a plan is TIGHT or INFEASIBLE.
//   { action: "move-deadline", projectId, deadline }   move the deadline
//   { action: "add-minutes", extraMin }                add minutes to every available day
// Deterministic, no AI: not gated by plan.
export async function PATCH(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const body = await readBody(request);
  if (!body) return badRequest("Invalid request");
  const today = await todayFor(userId, body.tz);

  try {
    if (body.action === "move-deadline") {
      if (typeof body.projectId !== "string" || !isDateKey(body.deadline) || body.deadline < today) {
        return badRequest("Invalid request");
      }
      const projects = await moveDeadline(userId, today, body.projectId, body.deadline);
      return projects ? NextResponse.json({ projects }) : NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (body.action === "add-minutes") {
      const extra = body.extraMin;
      if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 1 || extra > 600) {
        return badRequest("Invalid request");
      }
      return NextResponse.json({ projects: await addDailyMinutes(userId, today, extra) });
    }
    return badRequest("Invalid request");
  } catch (error) {
    console.error("project patch failed", error);
    return NextResponse.json({ error: "Failed to update the project" }, { status: 500 });
  }
}
