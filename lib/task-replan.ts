import { capacityOn, type Availability, type AvailabilityOverrides } from "@/lib/availability";
import { addDays, daysBetween } from "@/lib/recurrence";
import type { Task } from "@/types/task";

/**
 * Qué tareas sueltas se reacomodan cuando quedaron atrás, y adónde. Puro: sin base ni reloj.
 *
 * Reglas de oro:
 *  - se mueve `planned_on` (cuándo hacerla), NUNCA `due_date` (la fecha límite);
 *  - una tarea nunca se pasa de su fecha límite: si no entra antes, queda en conflicto;
 *  - lo fijado, los recordatorios, lo que tiene hora y lo que ya venció no se mueven solos.
 */

export type ReplanTask = Pick<Task, "id" | "title" | "kind" | "priority" | "estimateMin" | "dueDate" | "done" | "status"> &
  Partial<Pick<Task, "plannedOn" | "pinned" | "seriesId" | "time" | "postponedCount" | "conflict">>;

/** Cuándo hay que trabajarla: el día planificado si la replanificación la movió, si no el que vence. */
export function plannedDateOf(task: Pick<Task, "dueDate"> & Partial<Pick<Task, "plannedOn">>): string {
  return task.plannedOn ?? task.dueDate;
}

const isPending = (task: Pick<Task, "done" | "status">) => !task.done && task.status !== "skipped";

/**
 * ¿La replanificación puede mover esta tarea? Una tarea suelta y pendiente, sin hora y no fijada, cuyo día
 * planificado ya pasó pero cuya fecha límite todavía no.
 */
export function isReplannable(task: ReplanTask, today: string): boolean {
  return (
    task.kind === "task" &&
    !task.seriesId &&
    isPending(task) &&
    !task.pinned &&
    !task.time &&
    plannedDateOf(task) < today &&
    task.dueDate >= today
  );
}

/** Una tarea suelta cuya fecha límite ya pasó: no se mueve sola, queda en "Hoy" marcada. null si no aplica. */
export function daysPastDue(task: ReplanTask, today: string): number | null {
  if (task.kind !== "task" || task.seriesId || !isPending(task) || task.dueDate >= today) return null;
  return daysBetween(task.dueDate, today);
}

/** Un recordatorio o una tarea con hora que quedó atrás: no se mueve sola, se le pregunta al usuario. */
export function isOverdueFixed(task: ReplanTask, today: string): boolean {
  return (
    !task.seriesId &&
    isPending(task) &&
    (task.kind === "reminder" || (task.kind === "task" && Boolean(task.time))) &&
    task.dueDate < today
  );
}

export type PlannedMove = { taskId: string; title: string; from: string; to: string };
export type ReplanConflict = { taskId: string; title: string; dueDate: string; neededMin: number };

export type ReplanPlan = {
  moves: PlannedMove[];
  conflicts: ReplanConflict[];
  /** Tareas que tenían la marca de conflicto y ya no la merecen (se acomodaron o su fecha límite pasó). */
  resolved: string[];
};

export type ReplanInput = {
  /** "Hoy" del usuario, en su zona. */
  today: string;
  tasks: readonly ReplanTask[];
  availability: Availability;
  overrides?: AvailabilityOverrides;
  /**
   * Minutos por fecha que ya ocupan otras cosas: sesiones de proyecto y agenda ocupada (eventos y márgenes).
   * Nada se acomoda encima de un compromiso.
   */
  extraLoad?: Readonly<Record<string, number>>;
  /** Ids que hoy no se deben mover (por ejemplo, los que el usuario acaba de deshacer). */
  hold?: ReadonlySet<string>;
};

const PRIORITY_RANK: Record<Task["priority"], number> = { high: 0, medium: 1, low: 2 };
/** Hasta dónde se busca lugar: la fecha límite, con este tope por si es muy lejana. */
const MAX_SEARCH_DAYS = 366;

/**
 * Reparte las tareas atrasadas en los próximos días con lugar. Las más urgentes (fecha límite más cercana,
 * después prioridad) eligen primero. Es determinístico y no mueve lo que ya está bien: solo lo atrasado.
 */
export function planOverdueTasks(input: ReplanInput): ReplanPlan {
  const { today, availability, overrides = {}, extraLoad = {}, hold } = input;

  const candidates = input.tasks
    .filter((task) => isReplannable(task, today) && !hold?.has(task.id))
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.id.localeCompare(b.id)
    );
  const moving = new Set(candidates.map((task) => task.id));

  // Lo que ya ocupa cada día: lo planificado que no se está moviendo (lo atrasado que no se puede mover
  // cuenta hoy: sigue ahí) más lo que aportan las sesiones y la agenda.
  const load: Record<string, number> = { ...extraLoad };
  for (const task of input.tasks) {
    if (task.kind === "project" || !isPending(task) || moving.has(task.id)) continue;
    const date = plannedDateOf(task) < today ? today : plannedDateOf(task);
    load[date] = (load[date] ?? 0) + task.estimateMin;
  }

  const moves: PlannedMove[] = [];
  const conflicts: ReplanConflict[] = [];
  const resolved = new Set<string>();

  for (const task of candidates) {
    const last = daysBetween(today, task.dueDate) > MAX_SEARCH_DAYS ? addDays(today, MAX_SEARCH_DAYS) : task.dueDate;
    let placedOn: string | null = null;
    for (let date = today; date <= last; date = addDays(date, 1)) {
      const capacity = capacityOn(date, availability, overrides);
      // Una tarea más larga que cualquier día toma el primer día vacío: si no, no entraría nunca.
      const need = Math.min(task.estimateMin, capacity);
      if (capacity > 0 && capacity - (load[date] ?? 0) >= need) {
        placedOn = date;
        break;
      }
    }

    if (placedOn === null) {
      conflicts.push({ taskId: task.id, title: task.title, dueDate: task.dueDate, neededMin: task.estimateMin });
      continue;
    }
    load[placedOn] = (load[placedOn] ?? 0) + task.estimateMin;
    moves.push({ taskId: task.id, title: task.title, from: plannedDateOf(task), to: placedOn });
    if (task.conflict) resolved.add(task.id);
  }

  // Una marca de conflicto vieja sobre algo que ya venció (o que ya no está atrasado) no aplica más.
  for (const task of input.tasks) {
    if (task.conflict && !moving.has(task.id) && (!isPending(task) || task.dueDate < today)) resolved.add(task.id);
  }

  return { moves, conflicts, resolved: [...resolved] };
}
