import "server-only";
import sql from "@/lib/db";
import { durationFromMinutes, isValidEstimate } from "@/lib/task-estimate";
import { normalizeSteps } from "@/lib/task-steps";
import { Task, TaskKind, TaskStatus } from "@/types/task";

/**
 * Las fechas se leen con `::text` para que `occurrence_date` llegue como
 * "YYYY-MM-DD" y no como un `Date` que el driver interpretaría en la zona del
 * servidor y correría un día. Por eso las consultas listan las columnas en vez
 * de usar `*`.
 */

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  category: string;
  description: string;
  priority: Task["priority"];
  estimate_min: number;
  due_date: string;
  done: boolean;
  completed_at: string | null;
  steps: unknown;
  kind: TaskKind;
  remind_at: string | null;
  series_id: string | null;
  occurrence_date: string | null;
  status: TaskStatus;
  daily_cap_min: number | null;
};

export async function loadTasks(userId: string): Promise<Task[]> {
  const rows = await sql`
    SELECT id, user_id, title, category, description, priority, estimate_min, due_date,
           done, completed_at, steps, kind, remind_at, series_id,
           occurrence_date::text AS occurrence_date, status, daily_cap_min
    FROM tasks
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map(normalizeTask).filter((t): t is Task => t !== null);
}

export async function createTask(task: Task, userId: string): Promise<Task> {
  const rows = await sql`
    INSERT INTO tasks (id, user_id, title, category, description, priority, duration, estimate_min,
                       due_date, done, status, steps, kind, remind_at, daily_cap_min)
    VALUES (${task.id}, ${userId}, ${task.title}, ${task.category}, ${task.description},
            ${task.priority}, ${durationFromMinutes(task.estimateMin)}, ${task.estimateMin},
            ${task.dueDate}, ${task.done}, ${task.done ? "done" : "pending"},
            ${JSON.stringify(task.steps ?? [])}::jsonb, ${task.kind}, ${task.time ?? null},
            ${task.kind === "project" ? (task.dailyCapMin ?? null) : null})
    RETURNING id, user_id, title, category, description, priority, estimate_min, due_date,
              done, completed_at, steps, kind, remind_at, series_id,
              occurrence_date::text AS occurrence_date, status, daily_cap_min
  `;
  const created = normalizeTask(rows[0]);
  if (!created) throw new Error("Failed to create task.");
  return created;
}

/**
 * Devuelve null cuando la tarea no existe, no es del usuario, o el cambio no
 * está permitido (una ocurrencia de una serie no puede pasar a proyecto: los
 * proyectos no se repiten).
 *
 * `series_id` y `occurrence_date` no se tocan: son la identidad de la
 * ocurrencia. Mover una ocurrencia a otro día cambia `due_date`, no su lugar en
 * la serie, y por eso no se vuelve a generar.
 */
export async function updateTask(task: Task, userId: string): Promise<Task | null> {
  const rows = await sql`
    UPDATE tasks
    SET title = ${task.title}, category = ${task.category}, description = ${task.description},
        priority = ${task.priority}, duration = ${durationFromMinutes(task.estimateMin)},
        estimate_min = ${task.estimateMin}, due_date = ${task.dueDate},
        done = ${task.done}, steps = ${JSON.stringify(task.steps ?? [])}::jsonb,
        kind = ${task.kind}, remind_at = ${task.time ?? null},
        daily_cap_min = ${task.kind === "project" ? (task.dailyCapMin ?? null) : null},
        status = CASE WHEN ${task.done} THEN 'done'
                      WHEN status = 'done' THEN 'pending'
                      ELSE status END
    WHERE id = ${task.id} AND user_id = ${userId}
      AND (series_id IS NULL OR ${task.kind} <> 'project')
    RETURNING id, user_id, title, category, description, priority, estimate_min, due_date,
              done, completed_at, steps, kind, remind_at, series_id,
              occurrence_date::text AS occurrence_date, status, daily_cap_min
  `;
  return normalizeTask(rows[0]);
}

export async function setTaskDone(taskId: string, done: boolean, userId: string): Promise<Task> {
  const rows = await sql`
    UPDATE tasks
    SET done = ${done}, completed_at = ${done ? new Date().toISOString() : null},
        status = ${done ? "done" : "pending"}
    WHERE id = ${taskId} AND user_id = ${userId}
    RETURNING id, user_id, title, category, description, priority, estimate_min, due_date,
              done, completed_at, steps, kind, remind_at, series_id,
              occurrence_date::text AS occurrence_date, status, daily_cap_min
  `;
  const updated = normalizeTask(rows[0]);
  if (!updated) throw new Error("Failed to toggle task.");
  return updated;
}

export async function deleteTaskById(taskId: string, userId: string): Promise<void> {
  await sql`DELETE FROM tasks WHERE id = ${taskId} AND user_id = ${userId}`;
}

/** Todas las filas del usuario, ocurrencias incluidas: es el tope duro de almacenamiento. */
export async function countUserTasks(userId: string): Promise<number> {
  const rows = await sql`SELECT COUNT(*) as count FROM tasks WHERE user_id = ${userId}`;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Solo las tareas que el usuario creó a mano. Las ocurrencias las genera el
 * sistema, así que no gastan el cupo del plan Free: una serie diaria no debería
 * dejarlo sin poder agregar nada por dos semanas.
 */
export async function countUserLooseTasks(userId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*) as count FROM tasks WHERE user_id = ${userId} AND series_id IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

const KINDS: TaskKind[] = ["reminder", "task", "project"];
const STATUSES: TaskStatus[] = ["pending", "done", "skipped"];

export function normalizeTask(row: unknown): Task | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Partial<TaskRow>;
  if (
    typeof r.id === "string" &&
    typeof r.title === "string" &&
    typeof r.category === "string" &&
    typeof r.description === "string" &&
    (r.priority === "low" || r.priority === "medium" || r.priority === "high") &&
    typeof r.due_date === "string" &&
    typeof r.done === "boolean"
  ) {
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      description: r.description,
      priority: r.priority,
      // Una fila anterior a la migración (o de un despliegue viejo) puede no
      // traer minutos: 45 es lo que el backfill le daría a una "media".
      estimateMin: isValidEstimate(r.estimate_min) ? r.estimate_min : 45,
      dueDate: r.due_date,
      done: r.done,
      kind: KINDS.includes(r.kind as TaskKind) ? (r.kind as TaskKind) : "task",
      status: STATUSES.includes(r.status as TaskStatus)
        ? (r.status as TaskStatus)
        : r.done
          ? "done"
          : "pending",
      ...(r.remind_at ? { time: r.remind_at } : {}),
      ...(r.completed_at ? { completedAt: r.completed_at } : {}),
      ...(r.series_id ? { seriesId: r.series_id } : {}),
      ...(r.occurrence_date ? { occurrenceDate: r.occurrence_date } : {}),
      ...(typeof r.daily_cap_min === "number" && r.kind === "project" ? { dailyCapMin: r.daily_cap_min } : {}),
      steps: normalizeSteps(r.steps)
    };
  }
  return null;
}
