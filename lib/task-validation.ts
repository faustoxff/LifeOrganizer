import { isDateKey, normalizeRepeat } from "@/lib/recurrence";
import {
  isValidEstimate,
  minutesFromDuration,
  type LegacyDuration
} from "@/lib/task-estimate";
import { isValidSteps } from "@/lib/task-steps";
import type { RepeatSpec, Task, TaskKind } from "@/types/task";

/**
 * Validación del cuerpo de /api/tasks. Vive acá y no en la ruta para poder
 * probarla sin levantar Next.
 *
 * Lo que el cliente NO decide: `status`, `seriesId` y `occurrenceDate`. Son la
 * identidad de una ocurrencia y las maneja el servidor; aceptarlas desde el
 * cuerpo dejaría a un cliente pegar una tarea suelta a la serie de otra cosa, o
 * declarar "salteada" una tarea a mano.
 */

export const TASK_KINDS: TaskKind[] = ["reminder", "task", "project"];
export const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export type TaskPayload = {
  task: Task;
  /** Solo en la creación: si viene, el servidor crea una serie. */
  repeat?: RepeatSpec;
};

export type TaskPayloadResult =
  | { ok: true; value: TaskPayload }
  | { ok: false; error: string };

const fail = (error: string): TaskPayloadResult => ({ ok: false, error });

function legacyDuration(value: unknown): LegacyDuration | null {
  return value === "short" || value === "medium" || value === "long" ? value : null;
}

export function parseTaskPayload(value: unknown): TaskPayloadResult {
  if (!value || typeof value !== "object") return fail("Invalid task data");
  const t = value as Record<string, unknown>;

  if (
    typeof t.id !== "string" ||
    typeof t.title !== "string" ||
    typeof t.category !== "string" ||
    typeof t.description !== "string" ||
    typeof t.dueDate !== "string" ||
    typeof t.done !== "boolean" ||
    !(t.priority === "low" || t.priority === "medium" || t.priority === "high")
  ) {
    return fail("Invalid task data");
  }
  if (
    t.id.length > 100 ||
    t.title.length > 200 ||
    t.category.length > 60 ||
    t.description.length > 2000 ||
    t.dueDate.length > 32
  ) {
    return fail("Invalid task data");
  }
  if (t.steps !== undefined && !isValidSteps(t.steps)) return fail("Invalid task data");

  // Un navegador con la versión anterior de la app todavía manda `duration` y
  // nada de `kind`: se le acepta hasta que recargue, en vez de romperle el
  // guardado a mitad de una sesión.
  let estimateMin: number;
  if (t.estimateMin !== undefined) {
    if (!isValidEstimate(t.estimateMin)) return fail("Invalid estimate");
    estimateMin = t.estimateMin;
  } else {
    const legacy = legacyDuration(t.duration);
    if (!legacy) return fail("Invalid task data");
    estimateMin = minutesFromDuration(legacy);
  }

  const kind = t.kind === undefined ? "task" : t.kind;
  if (!TASK_KINDS.includes(kind as TaskKind)) return fail("Invalid kind");

  let time: string | undefined;
  if (t.time !== undefined && t.time !== null) {
    if (typeof t.time !== "string" || !TIME_RE.test(t.time)) return fail("Invalid time");
    time = t.time;
  }

  let repeat: RepeatSpec | undefined;
  if (t.repeat !== undefined && t.repeat !== null) {
    const normalized = normalizeRepeat(t.repeat);
    if (!normalized) return fail("Invalid repeat");
    // Los proyectos no se repiten: su forma de avanzar son las subtareas.
    if (kind === "project") return fail("A project cannot repeat");
    if (!isDateKey(t.dueDate)) return fail("Invalid due date");
    if (normalized.until && normalized.until < t.dueDate) return fail("Invalid repeat end");
    repeat = normalized;
  }

  const task: Task = {
    id: t.id,
    title: t.title,
    category: t.category,
    description: t.description,
    priority: t.priority,
    estimateMin,
    dueDate: t.dueDate,
    done: t.done,
    status: t.done ? "done" : "pending",
    kind: kind as TaskKind,
    ...(time ? { time } : {}),
    ...(t.steps !== undefined ? { steps: t.steps as Task["steps"] } : {})
  };

  return { ok: true, value: { task, ...(repeat ? { repeat } : {}) } };
}

export type EditScope = "this" | "following";

export function parseScope(value: unknown): EditScope {
  return value === "following" ? "following" : "this";
}
