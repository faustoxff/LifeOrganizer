import { AppLanguage, getDateLocale } from "@/lib/i18n";

export function getTodayDateValue() {
  return formatDateInput(new Date());
}

/** Zona horaria del dispositivo, ej. "America/Argentina/Buenos_Aires". */
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * "Hoy" ("YYYY-MM-DD") en la zona de un usuario.
 *
 * El servidor corre en UTC, así que `new Date()` da el día equivocado durante
 * varias horas cada noche para cualquiera que no esté en UTC (en Argentina, de
 * 21:00 a 24:00). Todo "hoy" calculado en el servidor pasa por acá.
 */
/**
 * Un `Date` cuyos campos UTC son la hora de pared de `timeZone`. No es un
 * instante real: existe para código que arma fechas de calendario con
 * `toISOString()` / `getUTC*()` (el prompt de Milo) y necesita que "hoy" sea el
 * del usuario. No se debe usar para comparar contra otros instantes.
 */
export function getZonedNow(timeZone: string, now: Date = new Date()): Date {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(
    Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"))
  );
}

export function getTodayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** La hora local (0-23) de un instante en la zona del usuario. Zona inválida = UTC. */
export function getHourInTimeZone(timeZone: string, now: Date = new Date()): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0;
}

export function formatTodayLongDate(language: AppLanguage) {
  const today = new Date();
  const locale = getDateLocale(language);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(today);
  const month = new Intl.DateTimeFormat(locale, { month: "long" }).format(today);

  if (language === "es") {
    const day = String(today.getDate()).padStart(2, "0");
    const year = today.getFullYear();

    return `${capitalizeFirstLetter(weekday)}, ${day} de ${month} del ${year}`;
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(today);
}

/**
 * Días de calendario hasta `dueDate`. Sin `today` usa el día del dispositivo
 * (cliente). El servidor tiene que pasarlo, calculado con la zona del usuario.
 */
export function getDaysUntilDueDate(dueDate: string, today?: string) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;

  if (today) {
    const diff = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
    return Math.round(diff / millisecondsPerDay);
  }

  const start = startOfDay(new Date());
  const targetDate = startOfDay(new Date(`${dueDate}T00:00:00`));

  return Math.round((targetDate.getTime() - start.getTime()) / millisecondsPerDay);
}

export function formatDueDate(dueDate: string, language: AppLanguage) {
  const date = new Date(`${dueDate}T00:00:00`);

  return new Intl.DateTimeFormat(getDateLocale(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

export function getDueDateLabel(dueDate: string, language: AppLanguage) {
  const daysUntilDueDate = getDaysUntilDueDate(dueDate);

  if (language === "es") {
    if (daysUntilDueDate < 0) {
      return "vencida";
    }

    if (daysUntilDueDate === 0) {
      return "vence hoy";
    }

    if (daysUntilDueDate === 1) {
      return "vence mañana";
    }

    return `vence en ${daysUntilDueDate} días`;
  }

  if (daysUntilDueDate < 0) {
    return "overdue";
  }

  if (daysUntilDueDate === 0) {
    return "due today";
  }

  if (daysUntilDueDate === 1) {
    return "due tomorrow";
  }

  return `due in ${daysUntilDueDate} days`;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function capitalizeFirstLetter(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
