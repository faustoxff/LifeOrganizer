import "server-only";
import { addDays } from "@/lib/recurrence";
import { busyLoadByDate } from "@/lib/busy-blocks";
import { getBusyBlocks } from "@/lib/busy-blocks-server";
import { replanProjects } from "@/lib/projects-service";
import { loadProjectRecords } from "@/lib/projects-storage";
import { applyPlannedMove, loadHeldIds, setConflictFlags } from "@/lib/replan-storage";
import { loadTasks } from "@/lib/storage";
import { planOverdueTasks, type PlannedMove, type ReplanConflict, type ReplanTask } from "@/lib/task-replan";
import { mergeLoads } from "@/lib/project-scheduling";
import { getAvailabilitySettings, getProjectsReplannedOn, markProjectsReplanned } from "@/lib/user-settings";
import type { Availability, AvailabilityOverrides } from "@/lib/availability";

/**
 * Un solo replan diario para todo.
 *
 * Corre una vez por día por usuario (el "hoy" es el suyo) cuando abre la app, y de nuevo con `force` tras un
 * cambio grande (cambiar la disponibilidad, conectar el calendario). Primero las tareas sueltas atrasadas, después
 * los proyectos (que ya ven las tareas en su día nuevo). Es idempotente: lo movido ya no está atrasado, así que
 * correrlo dos veces el mismo día no cambia nada.
 *
 * La lógica de decidir qué se mueve y adónde es pura (lib/task-replan.ts); acá solo se ordena el trabajo, así que
 * todo lo que toca datos entra por `ReplanDeps` y se prueba sin base.
 */

/** Cuántos días para adelante se mira la agenda ocupada. */
const BUSY_HORIZON_DAYS = 120;

export type ReplanContext = {
  tasks: ReplanTask[];
  availability: Availability;
  overrides: AvailabilityOverrides;
  /** Sesiones de proyecto y agenda ocupada, por fecha. */
  extraLoad: Record<string, number>;
  /** Tareas cuyo movimiento el usuario deshizo hoy. */
  hold: Set<string>;
};

export interface ReplanDeps {
  getReplannedOn(userId: string): Promise<string | null>;
  markReplanned(userId: string, today: string): Promise<void>;
  loadContext(userId: string, today: string): Promise<ReplanContext>;
  /** Devuelve false si la tarea ya no estaba donde se la quería sacar (otro pedido la movió antes). */
  applyMove(userId: string, move: PlannedMove, today: string): Promise<boolean>;
  setConflicts(userId: string, setIds: string[], clearIds: string[]): Promise<void>;
  replanProjects(userId: string, today: string): Promise<void>;
}

export type ReplanReport = {
  /** false = ya había corrido hoy y no se hizo nada. */
  ran: boolean;
  moved: PlannedMove[];
  conflicts: ReplanConflict[];
};

export async function replanAllWith(
  deps: ReplanDeps,
  userId: string,
  today: string,
  options: { force?: boolean } = {}
): Promise<ReplanReport> {
  if (!options.force && (await deps.getReplannedOn(userId)) === today) return { ran: false, moved: [], conflicts: [] };

  const context = await deps.loadContext(userId, today);
  const plan = planOverdueTasks({
    today,
    tasks: context.tasks,
    availability: context.availability,
    overrides: context.overrides,
    extraLoad: context.extraLoad,
    hold: context.hold
  });

  const moved: PlannedMove[] = [];
  for (const move of plan.moves) {
    if (await deps.applyMove(userId, move, today)) moved.push(move);
  }
  await deps.setConflicts(userId, plan.conflicts.map((c) => c.taskId), plan.resolved);

  // Los proyectos, con las tareas ya en su día nuevo. Si fallan, lo de las tareas ya quedó hecho.
  await deps.replanProjects(userId, today);
  await deps.markReplanned(userId, today);
  return { ran: true, moved, conflicts: plan.conflicts };
}

// ---------------------------------------------------------------------------
// La versión real
// ---------------------------------------------------------------------------

async function loadContext(userId: string, today: string): Promise<ReplanContext> {
  const [tasks, settings, records, hold] = await Promise.all([
    loadTasks(userId),
    getAvailabilitySettings(userId),
    loadProjectRecords(userId),
    loadHeldIds(userId, today)
  ]);

  // Lo que ya ocupan las sesiones de proyecto (de los que siguen en juego) y la agenda ocupada.
  const sessionLoad: Record<string, number> = {};
  for (const record of records) {
    if (record.task.done) continue;
    for (const session of record.sessions) {
      const subtask = record.subtasks.find((s) => s.id === session.subtaskId);
      if (!subtask || subtask.done) continue;
      sessionLoad[session.date] = (sessionLoad[session.date] ?? 0) + session.minutes;
    }
  }
  const busy = await getBusyBlocks(userId, today, addDays(today, BUSY_HORIZON_DAYS), { tasks });

  return {
    tasks,
    availability: settings.availability,
    overrides: settings.overrides,
    extraLoad: mergeLoads(sessionLoad, busyLoadByDate(busy.blocks, busy.timeZone)),
    hold
  };
}

const realDeps: ReplanDeps = {
  getReplannedOn: getProjectsReplannedOn,
  markReplanned: markProjectsReplanned,
  loadContext,
  applyMove: applyPlannedMove,
  setConflicts: setConflictFlags,
  replanProjects
};

/** Replanifica todo lo del usuario. `today` es el suyo (en su zona). */
export function replanAll(userId: string, today: string, options: { force?: boolean } = {}): Promise<ReplanReport> {
  return replanAllWith(realDeps, userId, today, options);
}

/** Lo que corre al abrir la app: una vez por día. */
export function ensureDailyReplan(userId: string, today: string): Promise<ReplanReport> {
  return replanAll(userId, today);
}
