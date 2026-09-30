import type { RecurrenceRule, RepeatFreq, RepeatSpec } from "@/types/task";

/**
 * Reglas de recurrencia: JSON propio, sin rrule.js.
 *
 * Todo trabaja con fechas "YYYY-MM-DD" y aritmética en UTC. Una fecha de
 * calendario no tiene zona horaria: pasarla por `new Date(local)` es lo que hace
 * que un día se corra en cuanto el servidor y el usuario no comparten zona.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ninguna ventana legítima (14 días) se acerca a esto; es solo un freno. */
const MAX_SCAN_DAYS = 3660;
export const MAX_INTERVAL = 365;

const FREQS: RepeatFreq[] = ["daily", "weekly", "monthly"];

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Date.parse acepta "2026-02-31" y lo corre a marzo: se compara de vuelta.
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function toUtc(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function fromUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(dateKey: string, days: number): string {
  return fromUtc(toUtc(dateKey) + days * DAY_MS);
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / DAY_MS);
}

/** 0 = domingo .. 6 = sábado. */
export function weekdayOf(dateKey: string): number {
  return new Date(toUtc(dateKey)).getUTCDay();
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Lunes de la semana que contiene la fecha. Las semanas van de lunes a domingo. */
function mondayOf(dateKey: string): string {
  const offset = (weekdayOf(dateKey) + 6) % 7;
  return addDays(dateKey, -offset);
}

function matches(rule: RecurrenceRule, startsOn: string, day: string): boolean {
  const interval = Math.max(1, Math.floor(rule.interval) || 1);

  if (rule.freq === "daily") {
    return daysBetween(startsOn, day) % interval === 0;
  }

  if (rule.freq === "weekly") {
    const weekdays = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(startsOn)];
    if (!weekdays.includes(weekdayOf(day))) return false;
    const weeks = Math.round(daysBetween(mondayOf(startsOn), mondayOf(day)) / 7);
    return weeks % interval === 0;
  }

  // monthly
  const [sy, sm, sd] = startsOn.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  const months = (y - sy) * 12 + (m - sm);
  if (months % interval !== 0) return false;
  const wanted = rule.monthDay ?? sd;
  return d === Math.min(wanted, daysInMonth(y, m - 1));
}

/**
 * Fechas de una serie dentro de [from, to], ambas inclusive.
 *
 * Nunca devuelve algo anterior a `startsOn` ni posterior a `endsOn`, aunque la
 * ventana pedida sea más ancha. `monthly` con un `monthDay` que el mes no tiene
 * cae en el último día de ese mes (31 → 28/29/30).
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  startsOn: string,
  endsOn: string | null | undefined,
  from: string,
  to: string
): string[] {
  const first = from > startsOn ? from : startsOn;
  const last = endsOn && endsOn < to ? endsOn : to;
  if (first > last) return [];

  const span = Math.min(daysBetween(first, last), MAX_SCAN_DAYS);
  const dates: string[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    const day = addDays(first, offset);
    if (matches(rule, startsOn, day)) dates.push(day);
  }
  return dates;
}

/**
 * Valida y normaliza un `repeat` que viene de afuera (Milo o la API).
 *
 * Devuelve null cuando no se puede confiar en él, y quien llama descarta el
 * `repeat` pero conserva la tarea: una recurrencia mal armada no debe costar el
 * ítem entero. Un `weekdays` fuera de rango cuenta como inválido en vez de
 * filtrarse: si el modelo escribió `[3, 9]` no sabemos qué quiso decir.
 */
export function normalizeRepeat(value: unknown): RepeatSpec | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  if (!FREQS.includes(raw.freq as RepeatFreq)) return null;
  const freq = raw.freq as RepeatFreq;

  let interval = 1;
  if (raw.interval !== undefined && raw.interval !== null) {
    if (typeof raw.interval !== "number" || !Number.isInteger(raw.interval)) return null;
    if (raw.interval < 1 || raw.interval > MAX_INTERVAL) return null;
    interval = raw.interval;
  }

  const repeat: RepeatSpec = { freq, interval };

  if (freq === "weekly" && raw.weekdays !== undefined && raw.weekdays !== null) {
    if (!Array.isArray(raw.weekdays)) return null;
    const days: number[] = [];
    for (const day of raw.weekdays) {
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) return null;
      if (!days.includes(day)) days.push(day);
    }
    if (days.length > 0) repeat.weekdays = days.sort((a, b) => a - b);
  }

  if (freq === "monthly" && raw.monthDay !== undefined && raw.monthDay !== null) {
    if (typeof raw.monthDay !== "number" || !Number.isInteger(raw.monthDay)) return null;
    if (raw.monthDay < 1 || raw.monthDay > 31) return null;
    repeat.monthDay = raw.monthDay;
  }

  // Un `until` ilegible se ignora en vez de invalidar la serie: sin él la serie
  // sigue acotada por la ventana móvil, así que no puede crecer sin límite.
  if (isDateKey(raw.until)) repeat.until = raw.until;

  return repeat;
}

/** La parte de `repeat` que va a task_series.rule (el `until` va a `ends_on`). */
export function ruleFromRepeat(repeat: RepeatSpec): RecurrenceRule {
  const rule: RecurrenceRule = { freq: repeat.freq, interval: repeat.interval };
  if (repeat.weekdays) rule.weekdays = repeat.weekdays;
  if (repeat.monthDay !== undefined) rule.monthDay = repeat.monthDay;
  return rule;
}

/** Lee una regla guardada en la base, que puede tener cualquier forma. */
export function parseStoredRule(value: unknown): RecurrenceRule | null {
  const repeat = normalizeRepeat(value);
  return repeat ? ruleFromRepeat(repeat) : null;
}
