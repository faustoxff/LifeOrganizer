import {
  DEFAULT_INFLATION,
  MIN_SAMPLES,
  learnInflation,
  type EstimateSample,
  type LearnedInflation
} from "@/lib/estimate-learning";

/**
 * Lo que Spark aprende de cómo trabaja cada usuario. Estadística pura: sin base de
 * datos, sin reloj y sin IA. La IA (Milo) solo redacta lo que sale de acá.
 */

/** Cuántos días para atrás mira el historial. */
export const HISTORY_DAYS = 90;
/** Completadas necesarias para decir cuándo rinde más. */
export const MIN_COMPLETED_FOR_HOURS = 15;
/** Postergaciones desde las que algo es "crónico". */
export const CHRONIC_POSTPONEMENTS = 3;
/** Tareas distintas postergadas para que una categoría entera cuente como crónica. */
export const CHRONIC_CATEGORY_MIN_TASKS = 2;

/** Una tarea o subtarea de los últimos 90 días, ya normalizada por el servidor. */
export type HistoryEntry = {
  title: string;
  category: string;
  estimateMin: number | null;
  /** Solo si se midió (modo foco). null = no se sabe, no se inventa. */
  actualMin: number | null;
  completed: boolean;
  /** Hora local 0-23 al completar. */
  completedHour: number | null;
  postponedCount: number;
};

const GENERAL = "general";

export function normalizeCategory(category: string | null | undefined): string {
  const clean = (category ?? "").trim().toLowerCase();
  return clean || GENERAL;
}

// ---------------------------------------------------------------------------
// Inflación por categoría
// ---------------------------------------------------------------------------

export type InflationSource = "category" | "global" | "default";

export type CategoryInflation = LearnedInflation & { source: InflationSource };

export type InflationByCategory = {
  global: LearnedInflation;
  /** Cada categoría con muestras medidas, con el factor que le toca y de dónde sale. */
  categories: Record<string, CategoryInflation>;
};

function samplesOf(history: readonly HistoryEntry[]): { category: string; sample: EstimateSample }[] {
  return history
    .filter((h) => h.completed && h.estimateMin !== null && h.actualMin !== null)
    .map((h) => ({
      category: normalizeCategory(h.category),
      sample: { estimateMin: h.estimateMin as number, actualMin: h.actualMin as number }
    }));
}

/**
 * Mediana de real / estimado por categoría, con el mismo criterio que `learnInflation`
 * (mínimo 5 muestras, entre 1.0 y 2.0). Una categoría sin muestras suficientes usa el
 * factor global; sin global suficiente, el default.
 */
export function learnInflationByCategory(history: readonly HistoryEntry[]): InflationByCategory {
  const all = samplesOf(history);
  const global = learnInflation(all.map((s) => s.sample));

  const grouped = new Map<string, EstimateSample[]>();
  for (const { category, sample } of all) grouped.set(category, [...(grouped.get(category) ?? []), sample]);

  const categories: Record<string, CategoryInflation> = {};
  for (const [category, samples] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const own = learnInflation(samples);
    if (own.learned) categories[category] = { ...own, source: "category" };
    else if (global.learned) categories[category] = { factor: global.factor, samples: own.samples, learned: false, source: "global" };
    else categories[category] = { factor: DEFAULT_INFLATION, samples: own.samples, learned: false, source: "default" };
  }
  return { global, categories };
}

/**
 * El factor para una categoría, también si nunca se midió nada en ella.
 * `fallback` es lo que se usa sin ningún aprendizaje (el scheduler usa 1.3; `plan_week`, 1).
 */
export function inflationFor(
  learned: InflationByCategory,
  category: string | null | undefined,
  fallback: number = DEFAULT_INFLATION
): CategoryInflation {
  const own = learned.categories[normalizeCategory(category)];
  if (own?.source === "category") return own;
  if (learned.global.learned) {
    return { factor: learned.global.factor, samples: own?.samples ?? 0, learned: false, source: "global" };
  }
  return { factor: fallback, samples: own?.samples ?? 0, learned: false, source: "default" };
}

/** Lo que se estima con esa categoría, ajustado a como suele tardar (múltiplos de 5). */
export function adjustedEstimate(estimateMin: number, factor: number): number {
  return Math.ceil((estimateMin * factor) / 5) * 5;
}

// ---------------------------------------------------------------------------
// Horas productivas
// ---------------------------------------------------------------------------

export type DayPart = "morning" | "afternoon" | "evening" | "night";

/** madrugada 0-6, mañana 6-12, tarde 12-19, noche 19-24. */
export function dayPartOf(hour: number): DayPart | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 19) return "afternoon";
  return "evening";
}

export const DAY_PARTS: readonly DayPart[] = ["morning", "afternoon", "evening", "night"];

export type ProductiveHours = {
  /** Completadas con hora conocida. */
  total: number;
  /** false = todavía no hay suficientes para decir nada. */
  learned: boolean;
  /** Cuántas completadas faltan para aprender (0 si ya se aprendió). */
  needed: number;
  counts: Record<DayPart, number>;
  /** Porcentaje de cada franja (0 si no hay datos). */
  shares: Record<DayPart, number>;
  /** La franja con más completadas; null si no se aprendió o hay empate en el primer puesto. */
  best: DayPart | null;
};

export function productiveHours(history: readonly HistoryEntry[]): ProductiveHours {
  const counts: Record<DayPart, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let total = 0;
  for (const entry of history) {
    if (!entry.completed || entry.completedHour === null) continue;
    const part = dayPartOf(entry.completedHour);
    if (!part) continue;
    counts[part] += 1;
    total += 1;
  }

  const learned = total >= MIN_COMPLETED_FOR_HOURS;
  const shares = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  if (total > 0) for (const part of DAY_PARTS) shares[part] = Math.round((counts[part] / total) * 100);

  let best: DayPart | null = null;
  if (learned) {
    const ranked = [...DAY_PARTS].sort((a, b) => counts[b] - counts[a]);
    if (counts[ranked[0]] > counts[ranked[1]]) best = ranked[0];
  }
  return { total, learned, needed: Math.max(0, MIN_COMPLETED_FOR_HOURS - total), counts, shares, best };
}

// ---------------------------------------------------------------------------
// Postergaciones crónicas
// ---------------------------------------------------------------------------

export type ChronicPostponers = {
  tasks: { title: string; category: string; count: number }[];
  categories: { category: string; count: number; tasks: number }[];
};

/**
 * Tareas que se postergaron 3+ veces, y categorías con 3+ postergaciones repartidas en
 * al menos 2 tareas (una sola tarea terca no hace crónica a su categoría: ya figura sola).
 */
export function chronicPostponers(history: readonly HistoryEntry[]): ChronicPostponers {
  const tasks = history
    .filter((h) => h.postponedCount >= CHRONIC_POSTPONEMENTS)
    .map((h) => ({ title: h.title, category: normalizeCategory(h.category), count: h.postponedCount }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  const perCategory = new Map<string, { count: number; tasks: number }>();
  for (const h of history) {
    if (h.postponedCount <= 0) continue;
    const key = normalizeCategory(h.category);
    const current = perCategory.get(key) ?? { count: 0, tasks: 0 };
    perCategory.set(key, { count: current.count + h.postponedCount, tasks: current.tasks + 1 });
  }
  const categories = [...perCategory.entries()]
    .filter(([, v]) => v.count >= CHRONIC_POSTPONEMENTS && v.tasks >= CHRONIC_CATEGORY_MIN_TASKS)
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return { tasks, categories };
}

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------

export type UserPatterns = {
  inflation: InflationByCategory;
  hours: ProductiveHours;
  postponers: ChronicPostponers;
  /** Entradas del historial que se usaron. */
  entries: number;
  /** Cuántas tareas con tiempo medido faltan para aprender el factor global. */
  measuredNeeded: number;
};

export function computePatterns(history: readonly HistoryEntry[]): UserPatterns {
  const inflation = learnInflationByCategory(history);
  return {
    inflation,
    hours: productiveHours(history),
    postponers: chronicPostponers(history),
    entries: history.length,
    measuredNeeded: Math.max(0, MIN_SAMPLES - inflation.global.samples)
  };
}
