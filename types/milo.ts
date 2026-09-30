import type { DeferredCode, Reason } from "@/lib/week-planner";
import type { TaskKind, TaskPriority } from "@/types/task";

/**
 * Lo que el chat muestra de un `plan_week`: la distribución por día, con una razón por
 * ítem. Es JSON plano (viaja del servidor al cliente y vuelve en el prompt).
 */
export interface ProposalItem {
  title: string;
  kind: TaskKind;
  priority: TaskPriority;
  /** Duración estimada, sin inflar. */
  estimateMin: number;
  /** Día en que quedó. En una recurrencia, el primero de la semana. */
  date: string;
  /** Solo recurrencias: todos los días de la semana que le tocan. */
  dates?: string[];
  fixed: boolean;
  reason: Reason;
}

export interface ProposalDay {
  date: string;
  capacityMin: number;
  existingMin: number;
  plannedMin: number;
  loadPct: number;
  light: boolean;
  items: ProposalItem[];
}

export interface ProposalDeferred {
  title: string;
  estimateMin: number;
  priority: TaskPriority;
  code: DeferredCode;
  neededMin: number;
  freeMin: number;
  suggestedDate: string;
}

export type ProposalWarning =
  | { code: "OVERBOOKED_DAY"; date: string; loadMin: number; capacityMin: number }
  | { code: "NO_LIGHT_DAY" }
  | { code: "DEADLINE_AT_RISK"; title: string; deadline: string };

export interface WeekProposal {
  weekStart: string;
  days: ProposalDay[];
  /** Fechas fijas que caen fuera de esta semana: se respetan y se crean igual. */
  outside: ProposalItem[];
  deferred: ProposalDeferred[];
  warnings: ProposalWarning[];
}

/** Un hecho que Milo guardó porque el usuario lo dijo (con sus palabras). */
export interface SavedFact {
  key: string;
  value: string;
}

/** Un hecho que Milo dedujo: NO está guardado hasta que el usuario lo confirma. */
export interface FactProposal {
  key: string;
  value: string;
  confidence: number;
}
