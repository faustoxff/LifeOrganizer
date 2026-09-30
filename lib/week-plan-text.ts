import { copy, getDateLocale, type AppLanguage } from "@/lib/i18n";
import type { ProposalDeferred, ProposalWarning } from "@/types/milo";
import type { Reason } from "@/lib/week-planner";

/**
 * El texto de una propuesta semanal. Vive aparte del planificador (que es puro y solo
 * habla en códigos) para que el mismo texto sirva a la tarjeta del chat, en el idioma
 * del usuario, y a Milo, que lo recibe en español y lo cuenta con sus palabras.
 */

/** "45 min", "2 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Día de la semana en el idioma dado, leído del propio "YYYY-MM-DD" (sin zona horaria). */
export function weekdayName(date: string, language: AppLanguage): string {
  return new Intl.DateTimeFormat(getDateLocale(language), { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

/** "lunes 28 sep". */
export function dayLabel(date: string, language: AppLanguage): string {
  return new Intl.DateTimeFormat(getDateLocale(language), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

export function describeReason(reason: Reason, language: AppLanguage): string {
  const t = copy[language].weekPlan.reasons;
  const other = reason.date ? weekdayName(reason.date, language) : "";
  const time = formatMinutes(reason.minutes ?? 0);
  switch (reason.code) {
    case "FIXED":
      return t.fixed;
    case "RECURRING":
      return t.recurring((reason.dates ?? []).map((d) => weekdayName(d, language)).join(", "));
    case "DEADLINE":
      return t.deadline(dayLabel(reason.deadline ?? reason.date ?? "", language));
    case "BEST_FIT":
      return t.bestFit;
    case "FULL":
      return t.full(other, time);
    case "HEAVY_CLASH":
      return t.heavyClash(other, reason.title ?? "");
    case "OVER_CAP":
      return t.overCap(other, time);
    case "KEEP_LIGHT":
      return t.keepLight(other);
    case "BUSIER":
      return t.busier(other, time);
  }
}

export function describeDeferred(item: ProposalDeferred, language: AppLanguage): string {
  const t = copy[language].weekPlan;
  const why =
    item.code === "TOO_BIG"
      ? t.deferredTooBig(formatMinutes(item.neededMin), formatMinutes(item.freeMin))
      : item.code === "NO_DAY"
        ? t.deferredNoDay
        : t.deferredNoRoom(formatMinutes(item.neededMin), formatMinutes(item.freeMin));
  return item.code === "NO_DAY" ? why : `${why}. ${t.deferredMove(dayLabel(item.suggestedDate, language))}`;
}

export function describeWarning(warning: ProposalWarning, language: AppLanguage): string {
  const t = copy[language].weekPlan;
  switch (warning.code) {
    case "OVERBOOKED_DAY":
      return t.warnOverbooked(dayLabel(warning.date, language));
    case "NO_LIGHT_DAY":
      return t.warnNoLightDay;
    case "DEADLINE_AT_RISK":
      return t.warnDeadline(warning.title);
  }
}
