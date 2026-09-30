import { blockKeyOf, type BusyBlock, type FreeWindow } from "@/lib/busy-blocks";
import { getDaysUntilDueDate, getHourInTimeZone, getTodayInTimeZone } from "@/lib/task-date";
import { getTaskScoreWithContext, getUrgencyPoints, isCriticalTask } from "@/lib/task-score";
import { isRecommendable } from "@/lib/task-views";
import { dayPartOf, inflationFor, type UserPatterns } from "@/lib/user-patterns";
import { isHeavy } from "@/lib/week-planner";
import type { Task } from "@/types/task";

/**
 * Qué conviene hacer AHORA, según cuánto tiempo hay hasta el próximo compromiso.
 *
 * Determinístico y sin IA: la misma tarea, los mismos bloques y el mismo reloj dan siempre la
 * misma respuesta. Milo y la tarjeta de "hoy" usan esta función; la IA solo la cuenta.
 */

/** Un bloque útil para avanzar en algo largo: menos que esto no vale la pena arrancar. */
export const MIN_USEFUL_BLOCK_MIN = 25;
/** "Vencimiento cercano": una tarea de prioridad baja solo compite si vence dentro de tantos días. */
export const NEAR_DUE_DAYS = 2;
/** Cansado: una tarea que lleva más que esto no se recomienda (salvo que venza hoy). */
export const TIRED_MAX_MIN = 30;
/** Lo que vale "Más" en los chips: un rato largo, siempre cortado por el próximo bloque real. */
export const MORE_MIN = 120;
/** Una elección manual vale este rato, o hasta que cambie el próximo bloque. */
export const MANUAL_MAX_AGE_MIN = 60;
/** Puntos que suma estar en la franja en que el usuario rinde más (solo a lo pesado y solo entre lo más urgente). */
export const BEST_TIME_BONUS = 3;

export type Energy = "tired";

export type BlockRef = Pick<BusyBlock, "id" | "title" | "start" | "end" | "source" | "importance">;

const refOf = (block: BusyBlock | null): BlockRef | null =>
  block ? { id: block.id, title: block.title, start: block.start, end: block.end, source: block.source, importance: block.importance } : null;

export type TaskReasonCode = "OVERDUE" | "DUE_TODAY" | "HIGH_PRIORITY" | "TIRED_LIGHT" | "FITS";
export type RestReasonCode = "IN_BLOCK" | "PREP_WINDOW" | "NOTHING_FITS" | "ONLY_LOW" | "NO_TASKS";

export type TaskRecommendation = {
  type: "task";
  task: Task;
  /** finish = terminarla en este rato; advance = avanzar un poco sin terminarla. */
  mode: "finish" | "advance";
  /** Minutos a dedicarle ahora: lo que lleva (finish) o cuánto avanzar (advance). */
  minutes: number;
  /** Lo que lleva la tarea entera, ya ajustado a cómo tarda el usuario. */
  needMin: number;
  reason: { code: TaskReasonCode; freeMin: number };
};

export type IdleRecommendation = {
  type: "rest" | "prepare";
  reason: { code: RestReasonCode; freeMin: number; block: BlockRef | null };
};

export type Recommendation = TaskRecommendation | IdleRecommendation;

export type RecommendationContext = {
  now: Date;
  timeZone: string;
  /** La ventana libre, ya con la corrección manual si hay una vigente. */
  window: FreeWindow;
  energy?: Energy;
  patterns?: UserPatterns | null;
};

// ---------------------------------------------------------------------------
// Corrección manual del tiempo libre
// ---------------------------------------------------------------------------

/** Una elección del usuario (minutos o "cansado") y en qué momento y frente a qué bloque la hizo. */
export type ManualChoice = { setAt: number; blockKey: string | null };

/** Sigue valiendo mientras no pasen 60 minutos ni cambie el próximo bloque. */
export function isChoiceValid(choice: ManualChoice | null | undefined, window: FreeWindow, now: Date): boolean {
  if (!choice) return false;
  const age = now.getTime() - choice.setAt;
  return age >= 0 && age < MANUAL_MAX_AGE_MIN * 60_000 && choice.blockKey === blockKeyOf(window);
}

/**
 * "Tengo X minutos": reemplaza la ventana calculada, pero nunca pasa por encima del próximo
 * compromiso real ni de la medianoche. Es la corrección de quien sabe algo que Spark no sabe
 * (terminó antes, la reunión se cayó), no un permiso para pisar un evento.
 */
export function withAvailableMinutes(window: FreeWindow, minutes: number): FreeWindow {
  const cap = Math.min(window.minutesToBlock ?? Number.POSITIVE_INFINITY, window.minutesToEndOfDay);
  return { ...window, freeMin: Math.max(0, Math.min(Math.floor(minutes), cap)), limit: "manual" };
}

// ---------------------------------------------------------------------------
// Recomendación
// ---------------------------------------------------------------------------

type Candidate = {
  task: Task;
  mode: "finish" | "advance";
  minutes: number;
  needMin: number;
  dueDays: number;
  urgency: number;
  base: number;
  heavy: boolean;
};

const floorTo5 = (n: number) => Math.floor(n / 5) * 5;

/** Lo que lleva la tarea para este usuario: su estimación por el factor de su categoría, si lo aprendió. */
function needMinutes(task: Task, patterns: UserPatterns | null | undefined): number {
  const factor = patterns ? inflationFor(patterns.inflation, task.category, 1).factor : 1;
  return Math.max(1, Math.ceil(task.estimateMin * factor));
}

/** Una tarea larga se puede avanzar si es de proyecto o tiene pasos. */
const isAdvanceable = (task: Task) => task.kind === "project" || (task.steps?.length ?? 0) > 0;

/**
 * Todas las opciones, la mejor primero. Nunca está vacía: si ninguna tarea sirve, la única
 * opción es descansar o prepararse.
 */
export function getRecommendations(tasks: readonly Task[], ctx: RecommendationContext): Recommendation[] {
  const { now, timeZone, window, patterns } = ctx;
  const freeMin = window.freeMin;
  const today = getTodayInTimeZone(timeZone, now);
  const hour = getHourInTimeZone(timeZone, now);
  const tired = ctx.energy === "tired";

  const pool = tasks.filter((task) => isRecommendable(task, today));
  const hasCritical = pool.some((task) => isCriticalTask(task, today));

  let lowSkipped = 0;
  const candidates: Candidate[] = [];
  for (const task of pool) {
    const needMin = needMinutes(task, patterns);
    const dueDays = getDaysUntilDueDate(task.dueDate, today);
    const dueToday = dueDays <= 0;

    let mode: "finish" | "advance";
    let minutes: number;
    if (freeMin <= 0) continue;
    if (needMin <= freeMin) {
      mode = "finish";
      minutes = needMin;
    } else if (isAdvanceable(task) && freeMin >= MIN_USEFUL_BLOCK_MIN) {
      mode = "advance";
      minutes = floorTo5(freeMin);
    } else {
      continue;
    }

    // Cansado: solo lo corto y liviano; lo que vence hoy sigue entrando.
    if (tired && !dueToday && (mode === "advance" || needMin > TIRED_MAX_MIN)) continue;

    // Una tarea de prioridad baja y sin vencimiento cerca no justifica ocupar el rato.
    if (task.priority === "low" && dueDays > NEAR_DUE_DAYS) {
      lowSkipped += 1;
      continue;
    }

    const heavy = isHeavy(task.estimateMin, task.priority);
    let base = getTaskScoreWithContext(task, { hasCriticalTasks: hasCritical, today });
    if (tired) base += (needMin <= 20 ? 3 : 0) - (heavy ? 4 : 0);
    candidates.push({ task, mode, minutes, needMin, dueDays, urgency: getUrgencyPoints(dueDays), base, heavy });
  }

  // Bonus por horario: solo a lo pesado y solo entre lo más urgente. Así nunca pasa por encima de una
  // fecha límite más cercana: a lo sumo desempata a lo que ya vence igual de pronto.
  const bestPart = patterns?.hours.learned ? patterns.hours.best : null;
  const topUrgency = candidates.reduce((max, c) => Math.max(max, c.urgency), 0);
  const inBestTime = bestPart !== null && dayPartOf(hour) === bestPart;
  const scoreOf = (c: Candidate) => c.base + (inBestTime && c.heavy && c.urgency === topUrgency ? BEST_TIME_BONUS : 0);

  candidates.sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) ||
      a.dueDays - b.dueDays ||
      (a.mode === b.mode ? 0 : a.mode === "finish" ? -1 : 1) ||
      a.task.title.localeCompare(b.task.title)
  );

  if (candidates.length > 0) {
    return candidates.map((c) => ({
      type: "task" as const,
      task: c.task,
      mode: c.mode,
      minutes: c.minutes,
      needMin: c.needMin,
      reason: { code: reasonFor(c, tired), freeMin }
    }));
  }
  return [idleRecommendation(window, pool.length > 0, lowSkipped > 0)];
}

function reasonFor(c: Candidate, tired: boolean): TaskReasonCode {
  if (c.dueDays < 0) return "OVERDUE";
  if (c.dueDays === 0) return "DUE_TODAY";
  if (c.task.priority === "high") return "HIGH_PRIORITY";
  if (tired && c.needMin <= TIRED_MAX_MIN) return "TIRED_LIGHT";
  return "FITS";
}

/** rest o prepare, según el próximo compromiso: prepararse si es importante o de calendario. */
function idleRecommendation(window: FreeWindow, hadTasks: boolean, hadLowFits: boolean): IdleRecommendation {
  const next = window.nextBlock;
  const prepare = next !== null && (next.importance === "high" || next.source === "calendar");
  const type = prepare ? "prepare" : "rest";

  if (window.currentBlock) {
    return { type: "rest", reason: { code: "IN_BLOCK", freeMin: 0, block: refOf(window.currentBlock) } };
  }
  const block = refOf(next);
  if (window.freeMin <= 0 && next) return { type, reason: { code: "PREP_WINDOW", freeMin: 0, block } };
  if (!hadTasks) return { type, reason: { code: "NO_TASKS", freeMin: window.freeMin, block } };
  return { type, reason: { code: hadLowFits ? "ONLY_LOW" : "NOTHING_FITS", freeMin: window.freeMin, block } };
}

/** La mejor opción para ahora. */
export function getRecommendedTask(tasks: readonly Task[], ctx: RecommendationContext): Recommendation {
  return getRecommendations(tasks, ctx)[0];
}
