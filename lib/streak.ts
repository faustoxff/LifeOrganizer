import { addDays, daysBetween } from "@/lib/recurrence";

/**
 * Streak badges. Each milestone unlocks a badge that is kept forever: badges
 * are earned on the best streak, not the current one, so breaking a run never
 * erases what was already achieved.
 */
export type StreakBadge = {
  /** 1-based position, also the bolt intensity step. */
  level: number;
  /** Consecutive days needed. */
  days: number;
};

export const STREAK_BADGES: StreakBadge[] = [
  { level: 1, days: 1 },
  { level: 2, days: 3 },
  { level: 3, days: 7 },
  { level: 4, days: 14 },
  { level: 5, days: 30 },
  { level: 6, days: 50 },
  { level: 7, days: 100 },
  { level: 8, days: 150 },
  { level: 9, days: 250 },
  { level: 10, days: 365 },
  { level: 11, days: 500 },
  { level: 12, days: 1000 }
];

/** Every badge unlocked by this many consecutive days. */
export function getEarnedBadges(days: number): StreakBadge[] {
  return STREAK_BADGES.filter((b) => days >= b.days);
}

/** The highest badge reached, or null before the first day. */
export function getCurrentBadge(days: number): StreakBadge | null {
  const earned = getEarnedBadges(days);
  return earned.length > 0 ? earned[earned.length - 1] : null;
}

/** The badge being worked towards, or null once every one is unlocked. */
export function getNextBadge(days: number): StreakBadge | null {
  return STREAK_BADGES.find((b) => days < b.days) ?? null;
}

/** Days left to unlock the next badge, or null when all are unlocked. */
export function getDaysToNextBadge(days: number): number | null {
  const next = getNextBadge(days);
  return next === null ? null : next.days - Math.max(0, days);
}

/** Progress from the current badge to the next one, 0 to 1. */
export function getBadgeProgress(days: number): number {
  const next = getNextBadge(days);
  if (next === null) return 1;
  const from = getCurrentBadge(days)?.days ?? 0;
  const span = next.days - from;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (Math.max(0, days) - from) / span));
}

/** Frena el recorrido hacia atrás; ninguna racha real se acerca a esto. */
const MAX_STREAK_DAYS = 5000;

/**
 * Racha a partir de días de calendario ("YYYY-MM-DD").
 *
 * `neutral` son días que ni suman ni cortan: los de una ocurrencia recurrente
 * que el usuario dejó pasar (`skipped`). No es lo mismo que un día vacío, que
 * sí corta la racha: el gimnasio de un miércoles salteado no debería borrar
 * semanas de constancia, porque nadie prometió hacerlo ese día sin excepción.
 * Un día neutral tampoco cuenta como día hecho: no infla la racha.
 *
 * Con `graceToday`, que hoy todavía no tenga nada no la rompe.
 */
export function streakFromDayKeys(
  completed: ReadonlySet<string>,
  neutral: ReadonlySet<string>,
  todayKey: string,
  graceToday: boolean
): number {
  if (completed.size === 0) return 0;

  let streak = 0;
  for (let offset = 0; offset < MAX_STREAK_DAYS; offset += 1) {
    const key = addDays(todayKey, -offset);
    if (completed.has(key)) {
      streak += 1;
    } else if (neutral.has(key) || (offset === 0 && graceToday)) {
      continue;
    } else {
      break;
    }
  }
  return streak;
}

/** Racha más larga de la historia, con los mismos días neutrales que la activa. */
export function bestStreakFromDayKeys(completed: Iterable<string>, neutral: ReadonlySet<string>): number {
  const days = [...new Set(completed)].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;

  for (const day of days) {
    if (previous !== null && isBridged(previous, day, neutral)) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/** `current` sigue a `previous` si son días seguidos o todo lo que hay en el medio es neutral. */
function isBridged(previous: string, current: string, neutral: ReadonlySet<string>): boolean {
  const gap = daysBetween(previous, current);
  if (gap === 1) return true;
  for (let step = 1; step < gap; step += 1) {
    if (!neutral.has(addDays(previous, step))) return false;
  }
  return gap > 1;
}

/**
 * Current streak from the task list itself, so every plan can see it without
 * calling the Pro-only stats endpoint. Counts back from today while each day
 * has at least one completed task; a day with nothing ends the run, except the
 * days in `skippedDates` (see `streakFromDayKeys`).
 */
export function getStreakFromCompletions(
  completedAt: (string | undefined)[],
  skippedDates: string[] = []
): number {
  const days = new Set(
    completedAt
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => new Date(value).toISOString().slice(0, 10))
  );

  // Today not being done yet must not break a run that is still alive.
  return streakFromDayKeys(days, new Set(skippedDates), new Date().toISOString().slice(0, 10), true);
}
