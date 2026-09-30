import type { ProjectPlan, SchedulerWarning, Session } from "@/lib/scheduler";
import type { Task } from "@/types/task";

export type QuestionType = "text" | "choice" | "number";

export interface IntakeQuestion {
  id: string;
  text: string;
  /** Por qué la respuesta cambia el plan. */
  why: string;
  type: QuestionType;
  /** Solo en `choice`. */
  options?: string[];
}

export interface Intake {
  /** 2-4 líneas de lo que la IA entendió, para que el usuario lo corrija. */
  understanding: string;
  questions: IntakeQuestion[];
}

export interface IntakeAnswer {
  id: string;
  question: string;
  answer: string;
}

/** Lo que la IA propone: qué hacer y cuánto lleva. Las fechas las pone el scheduler. */
export interface PlannedSubtask {
  tempId: string;
  title: string;
  estimateMin: number;
  dependsOn: string[];
  deliverable: boolean;
}

export interface ProjectSubtask {
  id: string;
  projectId: string;
  title: string;
  estimateMin: number;
  dependsOn: string[];
  position: number;
  done: boolean;
  doneAt?: string;
  actualMin?: number;
  deliverable: boolean;
  /** Si se saltea, no se agenda antes de esta fecha. */
  notBefore?: string;
  /** Fecha de la primera sesión. */
  scheduledDate?: string;
}

export interface ProjectSession {
  id: string;
  projectId: string;
  subtaskId: string;
  date: string;
  minutes: number;
  part: number;
  totalParts: number;
}

/** Un proyecto listo para mostrar: la tarea, sus subtareas, su agenda y cómo viene el plan. */
export interface ProjectView {
  task: Task;
  /** Resumen del texto de los archivos adjuntos ("" si no hubo). */
  contextSummary: string;
  subtasks: ProjectSubtask[];
  sessions: ProjectSession[];
  plan: ProjectPlan | null;
  warnings: SchedulerWarning[];
  progress: { done: number; total: number };
}

/** La respuesta de /api/projects/plan y /preview: subtareas más lo que el scheduler decidió. */
export interface ProjectDraftPlan {
  subtasks: PlannedSubtask[];
  sessions: Session[];
  plan: ProjectPlan;
  warnings: SchedulerWarning[];
  /** Factor con el que se inflaron las estimaciones (el aprendido del usuario, o 1.3). */
  inflation: number;
}
