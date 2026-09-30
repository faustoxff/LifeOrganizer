import { isValidTimeZone, getTodayInTimeZone } from "@/lib/task-date";
import { addDays } from "@/lib/recurrence";
import type { Task } from "@/types/task";

/**
 * La agenda ocupada del usuario: los momentos del día que ya no están libres.
 *
 * Puro: sin base ni reloj implícito. Los bloques llegan de fuentes (hoy, los recordatorios
 * y las tareas con hora; mañana, Google Calendar) y todo lo demás (la recomendación, el
 * scheduler, Milo) los lee sin saber de dónde vinieron.
 */

export type BusySource = "reminder" | "calendar" | "manual";
export type BusyImportance = "low" | "normal" | "high";

export type BusyBlock = {
  /** Estable entre lecturas: sirve para saber si "el próximo bloque" cambió. */
  id: string;
  /** Instantes ISO (UTC). */
  start: string;
  end: string;
  title: string;
  source: BusySource;
  importance: BusyImportance;
  /** Margen antes del compromiso, para prepararse o viajar. */
  prepMin: number;
};

/** Cuánto ocupa un recordatorio con hora en la agenda: un momento corto. */
export const REMINDER_BLOCK_MIN = 15;
export const DEFAULT_PREP_CALENDAR_MIN = 15;
export const DEFAULT_PREP_REMINDER_MIN = 0;
export const MAX_PREP_MIN = 240;

/** El margen por defecto de cada tipo de bloque, configurable por usuario. */
export type PrepSettings = { calendarMin: number; reminderMin: number };
export const DEFAULT_PREP: PrepSettings = { calendarMin: DEFAULT_PREP_CALENDAR_MIN, reminderMin: DEFAULT_PREP_REMINDER_MIN };

export function parsePrepMin(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_PREP_MIN ? value : null;
}

/** Lo que hay en la base puede tener cualquier forma: lo inválido cae al default. */
export function readPrep(calendarMin: unknown, reminderMin: unknown): PrepSettings {
  return {
    calendarMin: parsePrepMin(calendarMin) ?? DEFAULT_PREP.calendarMin,
    reminderMin: parsePrepMin(reminderMin) ?? DEFAULT_PREP.reminderMin
  };
}

// ---------------------------------------------------------------------------
// Zona horaria
// ---------------------------------------------------------------------------

/** Cuánto se adelanta la hora de pared de `timeZone` respecto de UTC en ese instante. */
function offsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(instantMs));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/**
 * El instante en que en `timeZone` son las `time` ("HH:MM") del día `date` ("YYYY-MM-DD").
 * Se recalcula el desfase una segunda vez para que un cambio de horario (DST) entre medio
 * no corra la hora. Una zona inválida se toma como UTC.
 */
export function localToInstant(date: string, time: string, timeZone: string): Date {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(guess, zone);
  return new Date(guess - offsetMs(first, zone));
}

/** La hora "HH:MM" que marca el reloj del usuario en ese instante. */
export function formatLocalTime(instant: Date | string, timeZone: string, hour12 = false): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" }).format(
    new Date(instant)
  );
}

/** El primer instante del día siguiente, en la zona del usuario. */
export function endOfLocalDay(now: Date, timeZone: string): Date {
  return localToInstant(addDays(getTodayInTimeZone(timeZone, now), 1), "00:00", timeZone);
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

type BlockTask = Pick<Task, "id" | "title" | "kind" | "priority" | "estimateMin" | "dueDate" | "time" | "done" | "status">;

const IMPORTANCE: Record<Task["priority"], BusyImportance> = { low: "low", medium: "normal", high: "high" };

const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export type CollectOptions = {
  timeZone: string;
  /** "YYYY-MM-DD", ambos incluidos. */
  from: string;
  to: string;
  prep?: PrepSettings;
};

/**
 * Los bloques que salen de las tareas del usuario: cada recordatorio con hora (un bloque corto) y cada
 * tarea que fijó a una hora (con su duración). Las sesiones de proyecto no tienen hora, así que no son
 * bloques. Lo que ya está hecho o salteado no ocupa nada.
 */
export function collectBusyBlocks(tasks: readonly BlockTask[], options: CollectOptions): BusyBlock[] {
  const prep = options.prep ?? DEFAULT_PREP;
  const blocks: BusyBlock[] = [];
  for (const task of tasks) {
    if (task.done || task.status === "skipped" || task.kind === "project" || !isTime(task.time)) continue;
    if (task.dueDate < options.from || task.dueDate > options.to) continue;
    const start = localToInstant(task.dueDate, task.time, options.timeZone);
    const minutes = task.kind === "reminder" ? REMINDER_BLOCK_MIN : Math.max(1, task.estimateMin);
    blocks.push({
      id: `task:${task.id}`,
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60_000).toISOString(),
      title: task.title,
      source: task.kind === "reminder" ? "reminder" : "manual",
      importance: IMPORTANCE[task.priority] ?? "normal",
      prepMin: prep.reminderMin
    });
  }
  return sortBlocks(blocks);
}

export function sortBlocks(blocks: readonly BusyBlock[]): BusyBlock[] {
  return [...blocks].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

/** Junta bloques de varias fuentes sin repetir ninguno (por id) y en orden. */
export function mergeBlocks(...lists: readonly (readonly BusyBlock[])[]): BusyBlock[] {
  const byId = new Map<string, BusyBlock>();
  for (const list of lists) for (const block of list) if (!byId.has(block.id)) byId.set(block.id, block);
  return sortBlocks([...byId.values()]);
}

// ---------------------------------------------------------------------------
// Ventana libre
// ---------------------------------------------------------------------------

export type FreeWindow = {
  /** Minutos libres desde ahora, ya restado el margen del próximo bloque. Nunca negativo. */
  freeMin: number;
  /** El bloque que limita la ventana (o al que le falta poco): null si nada la limita. */
  nextBlock: BusyBlock | null;
  /** El bloque en el que el usuario está metido ahora mismo. */
  currentBlock: BusyBlock | null;
  /** Minutos hasta que empieza el margen del próximo bloque. null si no hay próximo. */
  minutesToBlock: number | null;
  /** Minutos hasta medianoche, hora del usuario. */
  minutesToEndOfDay: number;
  limit: "block" | "in_block" | "capacity" | "end_of_day";
};

export type FreeWindowInput = {
  now: Date;
  blocks: readonly BusyBlock[];
  timeZone: string;
  /** Minutos de disponibilidad del día: tope cuando no hay ningún bloque más. */
  dayCapacityMin?: number;
};

const minutesBetween = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / 60_000));

/**
 * Cuánto tiempo libre tiene el usuario ahora y qué lo corta.
 *
 *  - Con un próximo bloque hoy: hasta que empiece su margen (`start - prepMin`).
 *  - Con un bloque ya empezado: 0 min (está metido en él) y se informa como `currentBlock`.
 *  - Sin nada más hoy: hasta medianoche, acotado por la disponibilidad del día.
 */
export function getFreeWindow({ now, blocks, timeZone, dayCapacityMin }: FreeWindowInput): FreeWindow {
  const nowMs = now.getTime();
  const endOfDayMs = endOfLocalDay(now, timeZone).getTime();
  const minutesToEndOfDay = minutesBetween(nowMs, endOfDayMs);

  const inside = blocks
    .filter((b) => Date.parse(b.start) <= nowMs && nowMs < Date.parse(b.end))
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
  const currentBlock = inside[0] ?? null;

  // El próximo es el que primero pisa su margen, entre los que todavía no empezaron y caen hoy.
  const upcoming = blocks
    .filter((b) => Date.parse(b.start) > nowMs && Date.parse(b.start) < endOfDayMs)
    .map((b) => ({ block: b, limitMs: Date.parse(b.start) - b.prepMin * 60_000 }))
    .sort((a, b) => a.limitMs - b.limitMs || a.block.id.localeCompare(b.block.id))[0];

  const minutesToBlock = upcoming ? minutesBetween(nowMs, upcoming.limitMs) : null;
  const nextBlock = upcoming?.block ?? null;

  if (currentBlock) {
    return { freeMin: 0, nextBlock, currentBlock, minutesToBlock, minutesToEndOfDay, limit: "in_block" };
  }
  if (nextBlock && minutesToBlock !== null) {
    return { freeMin: Math.min(minutesToBlock, minutesToEndOfDay), nextBlock, currentBlock: null, minutesToBlock, minutesToEndOfDay, limit: "block" };
  }
  const capped = dayCapacityMin !== undefined && dayCapacityMin < minutesToEndOfDay;
  return {
    freeMin: capped ? Math.max(0, Math.floor(dayCapacityMin)) : minutesToEndOfDay,
    nextBlock: null,
    currentBlock: null,
    minutesToBlock: null,
    minutesToEndOfDay,
    limit: capped ? "capacity" : "end_of_day"
  };
}

// ---------------------------------------------------------------------------
// Carga para el scheduler y el planificador semanal
// ---------------------------------------------------------------------------

export type BusyLoad = { date: string; title: string; minutes: number };

/**
 * Minutos que un bloque le resta a la capacidad de su día y que todavía no están contados.
 * Los recordatorios y las tareas con hora ya cuentan como carga fija por su estimado, así que
 * de esos solo se suma el margen; un evento de calendario ocupa toda su duración más el margen.
 */
export function busyLoads(blocks: readonly BusyBlock[], timeZone: string): BusyLoad[] {
  const loads: BusyLoad[] = [];
  for (const block of blocks) {
    const duration = minutesBetween(Date.parse(block.start), Date.parse(block.end));
    const minutes = (block.source === "calendar" ? duration : 0) + block.prepMin;
    if (minutes <= 0) continue;
    loads.push({ date: getTodayInTimeZone(timeZone, new Date(block.start)), title: block.title, minutes });
  }
  return loads;
}

/** Lo mismo, sumado por fecha: es lo que recibe el scheduler de proyectos. */
export function busyLoadByDate(blocks: readonly BusyBlock[], timeZone: string): Record<string, number> {
  const byDate: Record<string, number> = {};
  for (const load of busyLoads(blocks, timeZone)) byDate[load.date] = (byDate[load.date] ?? 0) + load.minutes;
  return byDate;
}
