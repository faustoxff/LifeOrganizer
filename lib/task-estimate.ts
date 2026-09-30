/**
 * Duración en minutos. La columna `duration` (short/medium/long) sigue en la base
 * por compatibilidad y se escribe siempre derivada de `estimate_min`.
 */

export type LegacyDuration = "short" | "medium" | "long";

/** Opciones que ofrece el formulario. La última es "120 o más". */
export const ESTIMATE_OPTIONS_MIN = [15, 30, 45, 60, 90, 120] as const;

export const DEFAULT_ESTIMATE_MIN = 45;

/** Cuánto dura si nadie lo dijo: un recordatorio son minutos, un proyecto horas. */
export const DEFAULT_ESTIMATE_BY_KIND = {
  reminder: 5,
  task: DEFAULT_ESTIMATE_MIN,
  project: 120
} as const;
export const MIN_ESTIMATE_MIN = 1;
export const MAX_ESTIMATE_MIN = 24 * 60;

/** Mismos cortes que el backfill de la migración, invertidos. */
export function durationFromMinutes(minutes: number): LegacyDuration {
  if (minutes <= 20) return "short";
  if (minutes <= 75) return "medium";
  return "long";
}

/** Igual que el backfill de neon/schema.sql: short=15, medium=45, long=120. */
export function minutesFromDuration(duration: LegacyDuration): number {
  if (duration === "short") return 15;
  if (duration === "medium") return 45;
  return 120;
}

export function isValidEstimate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_ESTIMATE_MIN &&
    value <= MAX_ESTIMATE_MIN
  );
}

/** Lleva cualquier valor a un estimado usable, sin lanzar. */
export function clampEstimate(value: unknown, fallback = DEFAULT_ESTIMATE_MIN): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_ESTIMATE_MIN, Math.max(MIN_ESTIMATE_MIN, Math.round(value)));
}

/** "45 min", "2 h", "1 h 30". Sin idioma: las unidades son universales. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}
