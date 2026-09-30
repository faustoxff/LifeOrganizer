import "server-only";
import sql from "@/lib/db";
import { isDateKey } from "@/lib/recurrence";
import { normalizeTask } from "@/lib/storage";
import type { PlannedMove } from "@/lib/task-replan";
import type { Task } from "@/types/task";

/**
 * Lo que la replanificación escribe. Toda consulta filtra por user_id: un id de tarea o de movimiento de otro
 * usuario no encuentra nada. Las fechas se leen con `::text` (ver lib/storage.ts).
 */

export type StoredMove = { id: string; taskId: string; title: string; from: string; to: string };

/**
 * Mueve una tarea a su día nuevo y deja el movimiento anotado, todo en UNA sentencia: los valores de antes (para
 * deshacer) y el cambio salen de la misma fila. Solo actúa si la tarea sigue en el día del que se la quiere
 * sacar: si dos pedidos corren a la vez, el segundo no encuentra nada que mover (no duplica ni suma dos veces).
 */
export async function applyPlannedMove(userId: string, move: PlannedMove, today: string): Promise<boolean> {
  if (!isDateKey(move.from) || !isDateKey(move.to) || !isDateKey(today)) return false;
  const rows = await sql`
    WITH prev AS (
      SELECT id, planned_on, postponed_count FROM tasks
      WHERE id = ${move.taskId} AND user_id = ${userId}
        AND COALESCE(planned_on::text, due_date) = ${move.from}
        AND pinned = FALSE AND done = FALSE AND status = 'pending'
        AND ${move.to} <= due_date
    ),
    moved AS (
      UPDATE tasks t
      SET postponed_count = t.postponed_count + CASE WHEN ${move.to} > ${move.from} THEN 1 ELSE 0 END,
          last_postponed_at = CASE WHEN ${move.to} > ${move.from} THEN NOW() ELSE t.last_postponed_at END,
          planned_on = ${move.to}::date,
          replan_conflict = FALSE
      FROM prev WHERE t.id = prev.id AND t.user_id = ${userId}
      RETURNING t.id
    )
    INSERT INTO replan_moves (id, user_id, task_id, title, from_date, to_date, prev_planned_on, prev_postponed_count, moved_on)
    SELECT ${crypto.randomUUID()}, ${userId}, prev.id, ${move.title}, ${move.from}::date, ${move.to}::date,
           prev.planned_on, prev.postponed_count, ${today}::date
    FROM prev JOIN moved ON moved.id = prev.id
    RETURNING id
  `;
  return rows.length > 0;
}

/** Marca (y desmarca) las tareas que no entran antes de su fecha límite. */
export async function setConflictFlags(userId: string, setIds: string[], clearIds: string[]): Promise<void> {
  if (setIds.length > 0) {
    await sql`
      UPDATE tasks SET replan_conflict = TRUE
      WHERE user_id = ${userId} AND id = ANY(${setIds}::text[]) AND replan_conflict = FALSE
    `;
  }
  if (clearIds.length > 0) {
    await sql`
      UPDATE tasks SET replan_conflict = FALSE
      WHERE user_id = ${userId} AND id = ANY(${clearIds}::text[]) AND replan_conflict = TRUE
    `;
  }
}

/** Los movimientos que el usuario todavía no vio (y no deshizo), del más viejo al más nuevo. */
export async function listUnseenMoves(userId: string): Promise<StoredMove[]> {
  const rows = await sql`
    SELECT id, task_id, title, from_date::text AS from_date, to_date::text AS to_date
    FROM replan_moves
    WHERE user_id = ${userId} AND seen = FALSE AND undone = FALSE
    ORDER BY created_at ASC, id ASC
    LIMIT 200
  `;
  return rows.map((r) => ({ id: String(r.id), taskId: String(r.task_id), title: String(r.title), from: String(r.from_date), to: String(r.to_date) }));
}

export async function markMovesSeen(userId: string): Promise<void> {
  await sql`UPDATE replan_moves SET seen = TRUE WHERE user_id = ${userId} AND seen = FALSE`;
}

/** Ids de las tareas cuyo movimiento el usuario deshizo hoy: hoy no se vuelven a mover. */
export async function loadHeldIds(userId: string, today: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT DISTINCT task_id FROM replan_moves
    WHERE user_id = ${userId} AND undone = TRUE AND moved_on = ${today}::date
  `;
  return new Set(rows.map((r) => String(r.task_id)));
}

/**
 * Deshace un movimiento: la tarea vuelve a su día y a su cuenta de postergaciones de antes. Solo si la tarea
 * sigue donde el replan la dejó (si el usuario ya la movió a mano, no se pisa). Devuelve la tarea o null.
 */
export async function undoPlannedMove(userId: string, moveId: string): Promise<Task | null> {
  const rows = await sql`
    WITH m AS (
      UPDATE replan_moves SET undone = TRUE, seen = TRUE
      WHERE id = ${moveId} AND user_id = ${userId} AND undone = FALSE
      RETURNING task_id, prev_planned_on, prev_postponed_count, to_date
    )
    UPDATE tasks t
    SET planned_on = m.prev_planned_on, postponed_count = m.prev_postponed_count
    FROM m
    WHERE t.id = m.task_id AND t.user_id = ${userId} AND t.planned_on = m.to_date
    RETURNING t.id, t.user_id, t.title, t.category, t.description, t.priority, t.estimate_min, t.due_date,
              t.done, t.completed_at, t.steps, t.kind, t.remind_at, t.series_id,
              t.occurrence_date::text AS occurrence_date, t.status, t.daily_cap_min, t.checklist,
              t.planned_on::text AS planned_on, t.pinned, t.postponed_count, t.replan_conflict
  `;
  return normalizeTask(rows[0]);
}

/** Un recordatorio o una tarea con hora vencida: pasarla a otro día. Cuenta la postergación y limpia lo planificado. */
export async function moveFixedToDate(userId: string, taskId: string, dueDate: string): Promise<boolean> {
  if (!isDateKey(dueDate)) return false;
  const rows = await sql`
    UPDATE tasks
    SET postponed_count = postponed_count + CASE WHEN ${dueDate} > due_date THEN 1 ELSE 0 END,
        last_postponed_at = CASE WHEN ${dueDate} > due_date THEN NOW() ELSE last_postponed_at END,
        due_date = ${dueDate}, planned_on = NULL, replan_conflict = FALSE
    WHERE id = ${taskId} AND user_id = ${userId} AND done = FALSE AND status = 'pending'
      AND ${dueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'
    RETURNING id
  `;
  return rows.length > 0;
}

/** Descartar: la tarea sale de "Hoy" y del calendario pero queda como historial (no se borra). */
export async function dismissTask(userId: string, taskId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE tasks SET status = 'skipped'
    WHERE id = ${taskId} AND user_id = ${userId} AND done = FALSE AND status = 'pending'
    RETURNING id
  `;
  return rows.length > 0;
}

/** Corre la fecha límite de una tarea suelta a un día posterior (la opción de un conflicto). */
export async function extendDeadline(userId: string, taskId: string, dueDate: string): Promise<boolean> {
  if (!isDateKey(dueDate)) return false;
  const rows = await sql`
    UPDATE tasks
    SET due_date = ${dueDate}, replan_conflict = FALSE
    WHERE id = ${taskId} AND user_id = ${userId} AND done = FALSE AND status = 'pending'
      AND kind = 'task' AND series_id IS NULL AND ${dueDate} > due_date
      AND ${dueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'
    RETURNING id
  `;
  return rows.length > 0;
}
