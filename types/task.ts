import type { TaskChecklist } from "@/lib/checklist";

export type TaskPriority = "low" | "medium" | "high";

/**
 * reminder: acción puntual (< ~10 min), con hora. Sin pasos.
 * task:     entra en una sentada (hasta ~2-3 h). Usa `steps`.
 * project:  varios días hasta una fecha límite. Tendrá subtareas (etapa 3).
 */
export type TaskKind = "reminder" | "task" | "project";

/** `done` se mantiene sincronizado: done === (status === "done"). */
export type TaskStatus = "pending" | "done" | "skipped";

export type RepeatFreq = "daily" | "weekly" | "monthly";

/** Regla de una serie, tal como se guarda en task_series.rule. */
export interface RecurrenceRule {
  freq: RepeatFreq;
  interval: number;
  /** 0 = domingo .. 6 = sábado. Solo en `weekly`. */
  weekdays?: number[];
  /** 1..31. Solo en `monthly`. Si el mes es más corto, cae en su último día. */
  monthDay?: number;
}

/** Lo que llega de la UI o de Milo: la regla más un fin opcional (`ends_on`). */
export interface RepeatSpec extends RecurrenceRule {
  until?: string;
}

export interface TaskInput {
  title: string;
  category: string;
  description: string;
  priority: TaskPriority;
  /** Duración estimada en minutos. */
  estimateMin: number;
  dueDate: string;
  kind: TaskKind;
  /** Hora local "HH:MM". Obligatoria para un recordatorio desde el formulario. */
  time?: string;
  /** Si viene, el servidor crea UNA serie en vez de una tarea suelta. */
  repeat?: RepeatSpec;
  /** Solo proyectos: tope de minutos por día que el scheduler puede darle. Sin valor = sin tope. */
  dailyCapMin?: number;
}

export interface TaskStep {
  id: string;
  text: string;
  done: boolean;
}

export interface Task extends Omit<TaskInput, "repeat"> {
  id: string;
  done: boolean;
  status: TaskStatus;
  completedAt?: string;
  // Small concrete sub-steps (AI-generated or edited by the user).
  steps?: TaskStep[];
  /** La checklist de "no te olvides" de esta tarea/ocurrencia, si ya se armó. */
  checklist?: TaskChecklist;
  // Presentes solo en las ocurrencias de una serie recurrente.
  seriesId?: string;
  occurrenceDate?: string;
}

/** Subtarea de un proyecto. Solo tipos en la etapa 1; la UI llega en la etapa 3. */
export interface Subtask {
  id: string;
  projectId: string;
  title: string;
  estimateMin?: number;
  dependsOn: string[];
  scheduledDate?: string;
  position: number;
  done: boolean;
  doneAt?: string;
  actualMin?: number;
}

export interface TaskSeries {
  id: string;
  kind: "reminder" | "task";
  title: string;
  category: string;
  description: string;
  priority: TaskPriority;
  estimateMin: number;
  time?: string;
  rule: RecurrenceRule;
  startsOn: string;
  endsOn?: string;
  active: boolean;
}
