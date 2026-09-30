import "server-only";
import { NextResponse } from "next/server";
import { addExtraMinutes } from "@/lib/project-scheduling";
import { addDays } from "@/lib/recurrence";
import { replanAll } from "@/lib/replan";
import { dismissTask, extendDeadline, listUnseenMoves, markMovesSeen, moveFixedToDate, undoPlannedMove } from "@/lib/replan-storage";
import { requireAuth } from "@/lib/server-auth";
import { loadTasks, setTaskDone } from "@/lib/storage";
import { getTodayInTimeZone } from "@/lib/task-date";
import { getAvailabilitySettings, resolveUserTimeZone, saveAvailabilitySettings } from "@/lib/user-settings";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const badRequest = (error = "Invalid request") => NextResponse.json({ error }, { status: 400 });

const MAX_EXTEND_DAYS = 60;
const MAX_EXTRA_MIN = 240;
const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

// GET /api/replan — lo que el replan movió y el usuario todavía no vio. Es lo que muestra el aviso único.
export async function GET() {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return unauthorized(); }

  try {
    return NextResponse.json({ moves: await listUnseenMoves(userId) });
  } catch (error) {
    console.error("listUnseenMoves failed", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

// POST /api/replan — acciones del aviso y de los conflictos. Todo es determinístico, sin IA, y no depende del plan.
//   { action: "seen" }                                   el usuario cerró el aviso
//   { action: "undo", moveId }                           deshacer un movimiento
//   { action: "run" }                                    "reacomodá ahora"
//   { action: "fixed", taskId, op: "done"|"tomorrow"|"dismiss" }   recordatorio o tarea con hora vencida
//   { action: "resolve", taskId, op: "extend", days }    conflicto: correr la fecha límite
//   { action: "resolve", op: "minutes", minutes }        conflicto: más minutos por día
export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return unauthorized(); }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return badRequest();

  try {
    const timeZone = await resolveUserTimeZone(userId, body.tz);
    const today = getTodayInTimeZone(timeZone);

    switch (body.action) {
      case "seen":
        await markMovesSeen(userId);
        return NextResponse.json({ ok: true });

      case "undo": {
        if (typeof body.moveId !== "string" || body.moveId.length > 100) return badRequest();
        const task = await undoPlannedMove(userId, body.moveId);
        return NextResponse.json({ undone: task !== null, task });
      }

      case "run": {
        const report = await replanAll(userId, today, { force: true });
        return NextResponse.json({ moved: report.moved.length, conflicts: report.conflicts.length });
      }

      case "fixed": {
        if (typeof body.taskId !== "string" || body.taskId.length > 100) return badRequest();
        if (body.op === "done") {
          await setTaskDone(body.taskId, true, userId);
        } else if (body.op === "tomorrow") {
          if (!(await moveFixedToDate(userId, body.taskId, addDays(today, 1)))) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        } else if (body.op === "dismiss") {
          if (!(await dismissTask(userId, body.taskId))) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        } else {
          return badRequest();
        }
        return NextResponse.json({ ok: true });
      }

      case "resolve": {
        if (body.op === "extend") {
          if (typeof body.taskId !== "string" || !isCount(body.days, MAX_EXTEND_DAYS)) return badRequest();
          const current = (await loadTasks(userId)).find((t) => t.id === body.taskId);
          if (!current) return NextResponse.json({ error: "Task not found" }, { status: 404 });
          if (!(await extendDeadline(userId, current.id, addDays(current.dueDate, body.days as number)))) {
            return NextResponse.json({ error: "Cannot move this deadline" }, { status: 409 });
          }
        } else if (body.op === "minutes") {
          if (!isCount(body.minutes, MAX_EXTRA_MIN)) return badRequest();
          const settings = await getAvailabilitySettings(userId);
          const boosted = addExtraMinutes(settings.availability, settings.overrides, body.minutes as number);
          await saveAvailabilitySettings(userId, boosted.availability, boosted.overrides);
        } else {
          return badRequest();
        }
        // Un cambio grande: se vuelve a acomodar todo con lo nuevo.
        const report = await replanAll(userId, today, { force: true });
        return NextResponse.json({ ok: true, moved: report.moved.length, conflicts: report.conflicts.length });
      }

      default:
        return badRequest();
    }
  } catch (error) {
    console.error("replan action failed", error);
    return NextResponse.json({ error: "Failed to replan" }, { status: 500 });
  }
}
