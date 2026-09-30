import type { Availability, AvailabilityOverrides } from "@/lib/availability";
import { MAX_DAILY_MINUTES } from "@/lib/availability";
import { DEFAULT_INFLATION } from "@/lib/estimate-learning";
import {
  replan,
  type PreviousPlan,
  type ReplanOutput,
  type ScheduleInput,
  type SchedulerProject,
  type Session
} from "@/lib/scheduler";
import type { PlannedSubtask, ProjectSession, ProjectSubtask } from "@/types/project";
import type { Task } from "@/types/task";

/**
 * Del estado guardado (tareas, subtareas, sesiones) a lo que entiende el scheduler, y
 * de vuelta. Pura: no toca la base ni el reloj.
 */

/** El proyecto que se está armando y todavía no existe. */
export const DRAFT_PROJECT_ID = "__draft__";
const DRAFT_PREFIX = "draft:";

/**
 * Minutos que las tareas normales ya ocupan por fecha. Cuenta cada tarea pendiente
 * en su fecha de vencimiento (lo vencido cuenta hoy). Los proyectos no: sus sesiones
 * son justamente lo que se está planificando.
 */
export function computeFixedLoad(tasks: readonly Task[], today: string): Record<string, number> {
  const load: Record<string, number> = {};
  for (const task of tasks) {
    if (task.kind === "project" || task.done || task.status === "skipped") continue;
    const date = task.dueDate < today ? today : task.dueDate;
    load[date] = (load[date] ?? 0) + task.estimateMin;
  }
  return load;
}

export function schedulerProjectFrom(
  task: Pick<Task, "id" | "dueDate" | "dailyCapMin">,
  subtasks: readonly ProjectSubtask[],
  /** El factor de la categoría del proyecto. Sin valor, el del plan. */
  inflation?: number
): SchedulerProject {
  return {
    id: task.id,
    deadline: task.dueDate,
    dailyCapMin: task.dailyCapMin ?? null,
    ...(inflation !== undefined ? { inflation } : {}),
    subtasks: [...subtasks]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        estimateMin: s.estimateMin,
        dependsOn: s.dependsOn,
        done: s.done,
        ...(s.actualMin !== undefined ? { actualMin: s.actualMin } : {}),
        ...(s.notBefore ? { notBefore: s.notBefore } : {})
      }))
  };
}

/** El proyecto en borrador, con los ids de las subtareas prefijados para no chocar con los reales. */
export function draftProject(
  deadline: string,
  dailyCapMin: number | null,
  planned: readonly PlannedSubtask[],
  inflation?: number
): SchedulerProject {
  return {
    id: DRAFT_PROJECT_ID,
    deadline,
    dailyCapMin,
    ...(inflation !== undefined ? { inflation } : {}),
    subtasks: planned.map((s) => ({
      id: `${DRAFT_PREFIX}${s.tempId}`,
      estimateMin: s.estimateMin,
      dependsOn: s.dependsOn.map((d) => `${DRAFT_PREFIX}${d}`),
      done: false
    }))
  };
}

/** Las sesiones del borrador con los ids de vuelta a los tempIds de la IA. */
export function unprefixDraftSessions(sessions: readonly Session[]): Session[] {
  return sessions
    .filter((s) => s.projectId === DRAFT_PROJECT_ID)
    .map((s) => ({ ...s, subtaskId: s.subtaskId.slice(DRAFT_PREFIX.length) }));
}

export type PlanContext = {
  today: string;
  availability: Availability;
  overrides: AvailabilityOverrides;
  /** Todas las tareas del usuario: de ahí sale la carga fija. */
  tasks: readonly Task[];
  /** Los proyectos ya creados y el borrador, si lo hay. */
  projects: readonly SchedulerProject[];
  /** Lo agendado hasta ahora: lo que `replan` intenta no mover. */
  previousSessions: readonly Session[];
  inflation?: number;
};

/**
 * Planifica todos los proyectos a la vez (compiten por el mismo tiempo) sin mover lo
 * que ya estaba agendado mientras siga siendo válido.
 */
export function planProjects(ctx: PlanContext): ReplanOutput {
  const input: ScheduleInput = {
    today: ctx.today,
    availability: ctx.availability,
    overrides: ctx.overrides,
    projects: [...ctx.projects],
    fixedLoad: computeFixedLoad(ctx.tasks, ctx.today),
    params: { inflation: ctx.inflation ?? DEFAULT_INFLATION }
  };
  const previous: PreviousPlan = { sessions: [...ctx.previousSessions] };
  return replan(input, previous);
}

export function sessionFromRecord(record: ProjectSession): Session {
  return {
    subtaskId: record.subtaskId,
    projectId: record.projectId,
    date: record.date,
    minutes: record.minutes,
    part: record.part,
    totalParts: record.totalParts
  };
}

export function progressOf(subtasks: readonly Pick<ProjectSubtask, "done">[]): { done: number; total: number } {
  return { done: subtasks.filter((s) => s.done).length, total: subtasks.length };
}

export type DayGroup<T extends { date: string; minutes: number }> = {
  date: string;
  minutes: number;
  items: T[];
};

/** Agrupa sesiones por día, en orden, para mostrarlas como un plan. */
export function groupByDay<T extends { date: string; minutes: number }>(sessions: readonly T[]): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const session of sessions) {
    const group = groups.get(session.date) ?? { date: session.date, minutes: 0, items: [] };
    group.minutes += session.minutes;
    group.items.push(session);
    groups.set(session.date, group);
  }
  return [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Suma `extraMin` a cada día que ya tiene disponibilidad (los de la semana y las
 * excepciones por fecha): un día en 0 sigue en 0, porque "no puedo ese día" no se
 * arregla con más minutos. Es lo mismo que simula `extraMinPerDay` del scheduler, así
 * que aplicarlo hace entrar el proyecto.
 */
export function addExtraMinutes(
  availability: Availability,
  overrides: AvailabilityOverrides,
  extraMin: number
): { availability: Availability; overrides: AvailabilityOverrides } {
  const bump = (minutes: number) => (minutes > 0 ? Math.min(MAX_DAILY_MINUTES, minutes + extraMin) : 0);
  const nextAvailability = { ...availability };
  for (const key of Object.keys(nextAvailability) as (keyof Availability)[]) {
    nextAvailability[key] = bump(nextAvailability[key]);
  }
  const nextOverrides: AvailabilityOverrides = {};
  for (const [date, minutes] of Object.entries(overrides)) nextOverrides[date] = bump(minutes);
  return { availability: nextAvailability, overrides: nextOverrides };
}

/** Las horas de un total de minutos, con un decimal: "6,5 h". */
export function totalHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}
