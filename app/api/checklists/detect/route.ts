import "server-only";
import { NextResponse } from "next/server";
import { authenticatePaid, badRequest, checklistContext, readBody } from "@/lib/checklist-route";
import { checklistDeps } from "@/lib/checklists-runtime";
import { detectActivities } from "@/lib/checklists-service";
import type { TaskKind } from "@/types/task";

const MAX_TASKS = 30;
const KINDS = ["reminder", "task", "project"];

// POST /api/checklists/detect — { tasks: [{ id, title, kind }] } → { activities: { [id]: key | null } }
//
// Reglas y caché primero; los títulos que quedan sin reconocer van a la IA en UN solo lote.
// El cliente pide esto para las tareas que todavía no clasificó.
export async function POST(request: Request) {
  const auth = await authenticatePaid();
  if ("response" in auth) return auth.response;

  const body = await readBody(request);
  if (!body || !Array.isArray(body.tasks)) return badRequest("tasks must be a list");
  if (body.tasks.length > MAX_TASKS) return badRequest(`At most ${MAX_TASKS} tasks per request`);

  const tasks: Array<{ id: string; title: string; kind: TaskKind }> = [];
  for (const raw of body.tasks) {
    const t = raw as { id?: unknown; title?: unknown; kind?: unknown };
    if (typeof t?.id !== "string" || typeof t.title !== "string" || !KINDS.includes(t.kind as string)) {
      return badRequest("Each task needs id, title and kind");
    }
    tasks.push({ id: t.id, title: t.title.slice(0, 200), kind: t.kind as TaskKind });
  }

  try {
    const ctx = await checklistContext(auth.userId, body.uiLanguage);
    return NextResponse.json({ activities: await detectActivities(ctx, tasks, checklistDeps(ctx, auth.plan)) });
  } catch (error) {
    console.error("[checklists] detect failed", error);
    return NextResponse.json({ error: "Failed to detect activities" }, { status: 500 });
  }
}
