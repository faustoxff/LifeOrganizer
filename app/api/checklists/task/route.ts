import "server-only";
import { NextResponse } from "next/server";
import type { ChecklistOp } from "@/lib/checklist";
import { authenticatePaid, badRequest, checklistContext, readBody } from "@/lib/checklist-route";
import { checklistDeps } from "@/lib/checklists-runtime";
import { dismissActivity, editChecklist, resolveChecklist } from "@/lib/checklists-service";

const OPS = ["toggle", "remove", "restore", "add"];
const notFound = () => NextResponse.json({ error: "Task not found" }, { status: 404 });

// POST /api/checklists/task — { taskId, uiLanguage? } → la checklist de esa tarea/ocurrencia.
// La arma la primera vez (con IA si la actividad es nueva para el usuario) y después la devuelve.
export async function POST(request: Request) {
  const auth = await authenticatePaid();
  if ("response" in auth) return auth.response;

  const body = await readBody(request);
  if (!body || typeof body.taskId !== "string") return badRequest("taskId is required");

  try {
    const ctx = await checklistContext(auth.userId, body.uiLanguage);
    const result = await resolveChecklist(ctx, body.taskId, checklistDeps(ctx, auth.plan));
    if (result.status === "no_task") return notFound();
    if (result.status === "no_activity") return NextResponse.json({ checklist: null });
    return NextResponse.json({ checklist: result.checklist, ...(result.degraded ? { degraded: result.degraded } : {}) });
  } catch (error) {
    console.error("[checklists] resolve failed", error);
    return NextResponse.json({ error: "Failed to build the checklist" }, { status: 500 });
  }
}

// PATCH /api/checklists/task — { taskId, op: toggle|remove|restore|add, text }
export async function PATCH(request: Request) {
  const auth = await authenticatePaid();
  if ("response" in auth) return auth.response;

  const body = await readBody(request);
  if (!body || typeof body.taskId !== "string" || typeof body.text !== "string" || !OPS.includes(body.op as string)) {
    return badRequest("taskId, op and text are required");
  }

  try {
    const ctx = await checklistContext(auth.userId, body.uiLanguage);
    const change = { op: body.op, text: body.text } as ChecklistOp;
    const result = await editChecklist(ctx, body.taskId, change, checklistDeps(ctx, auth.plan));
    if (result.status === "invalid") return badRequest(result.reason);
    if (result.status === "no_task") return notFound();
    if (result.status !== "ok") return badRequest("This task has no checklist");
    return NextResponse.json({ checklist: result.checklist });
  } catch (error) {
    console.error("[checklists] edit failed", error);
    return NextResponse.json({ error: "Failed to update the checklist" }, { status: 500 });
  }
}

// DELETE /api/checklists/task?taskId= — "esto no es una actividad": sin checklist para ese título.
export async function DELETE(request: Request) {
  const auth = await authenticatePaid();
  if ("response" in auth) return auth.response;

  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!taskId) return badRequest("taskId is required");

  try {
    const ctx = await checklistContext(auth.userId, null);
    return (await dismissActivity(ctx, taskId, checklistDeps(ctx, auth.plan))) ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) {
    console.error("[checklists] dismiss failed", error);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
