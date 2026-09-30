import { getDateLocale, type AppLanguage } from "@/lib/i18n";
import { weekdayOf } from "@/lib/recurrence";
import type { RepeatSpec } from "@/types/task";

export type RepeatLabels = {
  repeatOptions: { daily: string; monthly: string };
  repeatEvery: string;
  repeatWeeks: string;
  repeatDays: string;
  repeatMonths: string;
};

/** Nombre corto de un día de la semana (0 = domingo) en el idioma de la app. */
export function weekdayShortName(weekday: number, language: AppLanguage): string {
  // 2023-01-01 fue domingo.
  const date = new Date(Date.UTC(2023, 0, 1 + weekday));
  return new Intl.DateTimeFormat(getDateLocale(language), { weekday: "short", timeZone: "UTC" })
    .format(date)
    .replace(/\.$/, "");
}

/** Nombre completo de un día de la semana (0 = domingo) en el idioma de la app. */
export function weekdayLongName(weekday: number, language: AppLanguage): string {
  const date = new Date(Date.UTC(2023, 0, 1 + weekday));
  return new Intl.DateTimeFormat(getDateLocale(language), { weekday: "long", timeZone: "UTC" }).format(date);
}

/**
 * Una recurrencia en una línea, para mostrar en la lista y en las propuestas de
 * Milo: "Mié, Sáb", "Cada 2 semanas · Lun", "Todos los meses · 5".
 *
 * `startDate` decide el día cuando una regla semanal no trae `weekdays`: en ese
 * caso la serie repite el día de la semana en que empieza.
 */
export function describeRepeat(
  repeat: RepeatSpec,
  language: AppLanguage,
  labels: RepeatLabels,
  startDate?: string
): string {
  const { freq, interval } = repeat;

  if (freq === "daily") {
    return interval === 1
      ? labels.repeatOptions.daily
      : `${labels.repeatEvery} ${interval} ${labels.repeatDays}`;
  }

  if (freq === "weekly") {
    const days = repeat.weekdays ?? (startDate ? [weekdayOf(startDate)] : []);
    const names = days.map((day) => weekdayShortName(day, language)).join(", ");
    if (interval === 1) return names || `${labels.repeatEvery} 1 ${labels.repeatWeeks}`;
    const every = `${labels.repeatEvery} ${interval} ${labels.repeatWeeks}`;
    return names ? `${every} · ${names}` : every;
  }

  const base =
    interval === 1
      ? labels.repeatOptions.monthly
      : `${labels.repeatEvery} ${interval} ${labels.repeatMonths}`;
  return repeat.monthDay ? `${base} · ${repeat.monthDay}` : base;
}
