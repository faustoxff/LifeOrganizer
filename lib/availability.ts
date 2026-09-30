import { isDateKey, weekdayOf } from "@/lib/recurrence";

/**
 * Cuánto tiempo puede dedicar el usuario a sus pendientes cada día.
 *
 * Minutos por día de la semana, con las claves "0".."6" (0 = domingo). Es lo que
 * el scheduler llena; no tiene nada de IA.
 */
export type Availability = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", number>;

/** { "YYYY-MM-DD": minutos }. Un override reemplaza al valor del día de la semana. */
export type AvailabilityOverrides = Record<string, number>;

/** Lunes a viernes 2 h, sábado 3 h, domingo 1 h. */
export const DEFAULT_AVAILABILITY: Availability = {
  "0": 60,
  "1": 120,
  "2": 120,
  "3": 120,
  "4": 120,
  "5": 120,
  "6": 180
};

export const MAX_DAILY_MINUTES = 24 * 60;
export const MAX_OVERRIDES = 366;

const WEEKDAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

function isMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DAILY_MINUTES
  );
}

/**
 * Valida una disponibilidad que viene de afuera. Exige los siete días: una
 * disponibilidad a medias se interpretaría como "0 minutos" los días que faltan
 * y dejaría a un proyecto sin poder avanzar sin explicación.
 */
export function parseAvailability(value: unknown): Availability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const result = {} as Availability;
  for (const key of WEEKDAY_KEYS) {
    if (!isMinutes(raw[key])) return null;
    result[key] = raw[key] as number;
  }
  return result;
}

/**
 * Valida overrides de afuera: cualquier fecha inexistente o minutos fuera de
 * rango invalida todo el objeto, para que un error del cliente no se guarde a
 * medias.
 */
export function parseOverrides(value: unknown): AvailabilityOverrides | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_OVERRIDES) return null;
  const result: AvailabilityOverrides = {};
  for (const [date, minutes] of entries) {
    if (!isDateKey(date) || !isMinutes(minutes)) return null;
    result[date] = minutes;
  }
  return result;
}

/** Lo que hay en la base puede tener cualquier forma: lo inválido se descarta, no rompe. */
export function readAvailability(value: unknown): Availability {
  return parseAvailability(value) ?? { ...DEFAULT_AVAILABILITY };
}

export function readOverrides(value: unknown): AvailabilityOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: AvailabilityOverrides = {};
  for (const [date, minutes] of Object.entries(value as Record<string, unknown>)) {
    if (isDateKey(date) && isMinutes(minutes)) result[date] = minutes;
  }
  return result;
}

/** Minutos que el usuario tiene disponibles ese día, antes de restar la carga fija. */
export function capacityOn(
  date: string,
  availability: Availability,
  overrides: AvailabilityOverrides = {}
): number {
  const override = overrides[date];
  if (override !== undefined) return override;
  return availability[String(weekdayOf(date)) as keyof Availability] ?? 0;
}
