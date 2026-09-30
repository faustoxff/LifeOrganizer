import { normalizeCategory } from "@/lib/user-patterns";
import { capacityOn, type Availability, type AvailabilityOverrides } from "@/lib/availability";
import { addDays, isDateKey, occurrencesBetween, ruleFromRepeat } from "@/lib/recurrence";
import { effectiveMinutes } from "@/lib/scheduler";
import type { RepeatSpec, TaskKind, TaskPriority } from "@/types/task";

/**
 * Cómo repartir una semana con criterio humano. Puro: no toca la base ni el reloj, y
 * el mismo input da siempre el mismo output. Ver "Etapa 4" en docs/roadmap.md.
 *
 * Reusa del scheduler la capacidad por día y la duración efectiva. No usa `schedule()`
 * para colocar: allá una subtarea se parte en sesiones y se encadena, y acá cada ítem
 * es atómico (una tarea de 60 min no se corta en dos días).
 */

export const WINDOW_DAYS = 7;
/** Ocupación a partir de la cual un día se considera lleno mientras haya otro con lugar. */
export const SOFT_CAP = 0.85;
/** Un día liviano ocupa hasta esta parte de su capacidad. */
export const LIGHT_LIMIT = 0.5;
/** Pesada: dura esto o más... */
export const HEAVY_MIN = 90;
/** ...o es de prioridad alta y dura esto o más. */
export const HEAVY_HIGH_MIN = 60;
export const MAX_WEEK_ITEMS = 25;

export type WeekItem = {
  title: string;
  kind: TaskKind;
  estimateMin: number;
  priority: TaskPriority;
  category?: string;
  time?: string;
  /** Fecha fija: el ítem va ese día. Sin fecha, es flexible. */
  dueDate?: string;
  /** Solo flexibles: no después de este día. */
  deadline?: string;
  repeat?: RepeatSpec;
};

/** Lo que el usuario ya tiene agendado (tareas, ocurrencias, sesiones de proyecto). */
export type ExistingEntry = { date: string; title: string; minutes: number; priority?: TaskPriority };

export type WeekPlanInput = {
  /** Hoy, en la zona del usuario. Nada se coloca antes. */
  today: string;
  /** Primer día de la ventana de 7 días. */
  weekStart: string;
  availability: Availability;
  overrides?: AvailabilityOverrides;
  existing?: readonly ExistingEntry[];
  items: readonly WeekItem[];
  /** Factor de la duración de los ítems nuevos. 1 = usar la estimación tal cual. */
  inflation?: number;
  /** Factor propio de las categorías que el usuario ya midió. Manda sobre `inflation`. */
  inflationByCategory?: Readonly<Record<string, number>>;
};

export type ReasonCode =
  | "FIXED"
  | "RECURRING"
  | "DEADLINE"
  | "BEST_FIT"
  | "FULL"
  | "HEAVY_CLASH"
  | "OVER_CAP"
  | "KEEP_LIGHT"
  | "BUSIER";

/** Por qué un ítem quedó donde quedó. `date` es el día que se descartó, cuando hay uno. */
export type Reason = {
  code: ReasonCode;
  /** Día descartado (o, en `FIXED`/`DEADLINE`, el día). */
  date?: string;
  /** Minutos que ya tenía ese día (o el elegido en `BEST_FIT`). */
  minutes?: number;
  /** Lo más grande que ya había ese día. */
  title?: string;
  /** Solo `DEADLINE`. */
  deadline?: string;
  /** Solo `RECURRING`: los días de la semana que le tocan. */
  dates?: string[];
};

export type Placed = {
  /** Posición del ítem en `items`. */
  index: number;
  item: WeekItem;
  date: string;
  fixed: boolean;
  /** Fuera de la ventana (fecha fija que cae otra semana): se respeta pero no cuenta acá. */
  outsideWindow: boolean;
  reason: Reason;
};

export type DeferredCode = "NO_ROOM" | "TOO_BIG" | "NO_DAY";

export type Deferred = {
  index: number;
  item: WeekItem;
  code: DeferredCode;
  /** Minutos que faltaban / que pedía. */
  neededMin: number;
  /** Lo que quedaba libre en la mejor opción. */
  freeMin: number;
  /** Primer día de la semana siguiente. */
  suggestedDate: string;
};

export type DayPlan = {
  date: string;
  capacityMin: number;
  /** Ya agendado antes de este plan. */
  existingMin: number;
  /** Lo que este plan agrega. */
  plannedMin: number;
  loadPct: number;
  light: boolean;
  heavy: boolean;
  /** Índices de `placed` que caen este día. */
  placed: number[];
};

export type WeekWarning =
  | { code: "OVERBOOKED_DAY"; date: string; loadMin: number; capacityMin: number }
  | { code: "NO_LIGHT_DAY" }
  | { code: "DEADLINE_AT_RISK"; index: number; deadline: string };

export type WeekPlan = {
  weekStart: string;
  days: DayPlan[];
  placed: Placed[];
  deferred: Deferred[];
  warnings: WeekWarning[];
};

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

// Penalizaciones en escalones: cada una domina a todo lo de abajo, así el orden de
// criterios es exactamente el que se pidió (pesadas > tope > día liviano > parejo).
const PENALTY_HEAVY = 3000;
const PENALTY_SOFT_CAP = 2000;
const PENALTY_LIGHT_DAY = 1000;
/** Puntos por cada día de espera. Chico frente a la ocupación: desempata, no manda. */
const EARLY_BIAS = 6;

export function isHeavy(estimateMin: number, priority: TaskPriority | undefined): boolean {
  return estimateMin >= HEAVY_MIN || (priority === "high" && estimateMin >= HEAVY_HIGH_MIN);
}

type DayState = {
  date: string;
  capacity: number;
  existingMin: number;
  plannedMin: number;
  heavyCount: number;
  count: number;
  entries: Array<{ title: string; minutes: number }>;
};

const load = (day: DayState) => day.existingMin + day.plannedMin;

function biggest(day: DayState): string | undefined {
  let best: { title: string; minutes: number } | undefined;
  for (const entry of day.entries) if (!best || entry.minutes > best.minutes) best = entry;
  return best?.title;
}

export function planWeek(input: WeekPlanInput): WeekPlan {
  const { today, weekStart, availability, overrides = {}, items } = input;
  const inflation = input.inflation ?? 1;
  const byCategory = input.inflationByCategory ?? {};
  const minutesOf = (item: WeekItem) =>
    effectiveMinutes(item.estimateMin, byCategory[normalizeCategory(item.category)] ?? inflation);

  const windowDays: string[] = [];
  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    const date = addDays(weekStart, offset);
    if (date >= today) windowDays.push(date);
  }
  const windowEnd = addDays(weekStart, WINDOW_DAYS - 1);
  const nextWeek = addDays(weekStart, WINDOW_DAYS);

  const days = new Map<string, DayState>(
    windowDays.map((date) => [
      date,
      {
        date,
        capacity: capacityOn(date, availability, overrides),
        existingMin: 0,
        plannedMin: 0,
        heavyCount: 0,
        count: 0,
        entries: []
      }
    ])
  );

  for (const entry of input.existing ?? []) {
    // Lo vencido cuenta hoy, igual que en la carga fija de los proyectos.
    const date = entry.date < today ? today : entry.date;
    const day = days.get(date);
    if (!day) continue;
    day.existingMin += entry.minutes;
    day.count += 1;
    day.entries.push({ title: entry.title, minutes: entry.minutes });
    if (isHeavy(entry.minutes, entry.priority)) day.heavyCount += 1;
  }

  const placed: Placed[] = [];
  const deferred: Deferred[] = [];

  const addToDay = (day: DayState, item: WeekItem, minutes: number) => {
    day.plannedMin += minutes;
    day.count += 1;
    day.entries.push({ title: item.title, minutes });
    if (isHeavy(item.estimateMin, item.priority)) day.heavyCount += 1;
  };

  // --- 1. Lo que tiene fecha: va en su fecha --------------------------------------------
  const flexible: number[] = [];
  items.forEach((item, index) => {
    if (item.repeat) {
      const rule = ruleFromRepeat(item.repeat);
      const startsOn = item.dueDate && isDateKey(item.dueDate) ? item.dueDate : windowDays[0] ?? weekStart;
      const dates = windowDays.length
        ? occurrencesBetween(rule, startsOn, item.repeat.until, windowDays[0], windowEnd)
        : [];
      placed.push({
        index,
        item,
        date: dates[0] ?? startsOn,
        fixed: true,
        outsideWindow: dates.length === 0,
        reason: { code: "RECURRING", dates }
      });
      for (const date of dates) {
        const day = days.get(date);
        if (day) addToDay(day, item, minutesOf(item));
      }
      return;
    }
    if (item.dueDate && isDateKey(item.dueDate)) {
      const day = days.get(item.dueDate);
      placed.push({
        index,
        item,
        date: item.dueDate,
        fixed: true,
        outsideWindow: !day,
        reason: { code: "FIXED", date: item.dueDate }
      });
      if (day) addToDay(day, item, minutesOf(item));
      return;
    }
    flexible.push(index);
  });

  // --- 2. Admisión: qué entra en la semana, por prioridad y fecha ------------------------
  const usable = [...days.values()].filter((day) => day.capacity > 0);
  let free = usable.reduce((sum, day) => sum + Math.max(0, day.capacity - load(day)), 0);
  const admissionOrder = [...flexible].sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return (
      PRIORITY_RANK[ia.priority] - PRIORITY_RANK[ib.priority] ||
      (ia.deadline ?? "9999-12-31").localeCompare(ib.deadline ?? "9999-12-31") ||
      a - b
    );
  });

  const admitted: number[] = [];
  for (const index of admissionOrder) {
    const item = items[index];
    const minutes = minutesOf(item);
    const eligible = eligibleDays(item);
    if (eligible.length === 0) {
      deferred.push({ index, item, code: "NO_DAY", neededMin: minutes, freeMin: 0, suggestedDate: nextWeek });
      continue;
    }
    if (minutes > Math.max(0, ...eligible.map((day) => day.capacity))) {
      deferred.push({
        index,
        item,
        code: "TOO_BIG",
        neededMin: minutes,
        freeMin: Math.max(0, ...eligible.map((day) => day.capacity)),
        suggestedDate: nextWeek
      });
      continue;
    }
    if (minutes > free) {
      deferred.push({ index, item, code: "NO_ROOM", neededMin: minutes, freeMin: Math.round(free), suggestedDate: nextWeek });
      continue;
    }
    free -= minutes;
    admitted.push(index);
  }

  function eligibleDays(item: WeekItem): DayState[] {
    return windowDays
      .map((date) => days.get(date)!)
      .filter((day) => day.capacity > 0 && (!item.deadline || day.date <= item.deadline));
  }

  // --- 3. Día liviano: se guarda el de menos carga ---------------------------------------
  let lightDate: string | null = null;
  if (usable.length >= 3) {
    let best: DayState | null = null;
    for (const day of usable) {
      const ratio = load(day) / day.capacity;
      // Empate: el último de la semana, que es donde suele estar el descanso.
      if (!best || ratio < load(best) / best.capacity || ratio === load(best) / best.capacity) best = day;
    }
    if (best && load(best) / best.capacity <= LIGHT_LIMIT) lightDate = best.date;
  }

  // --- 4. Colocación: de la ventana más angosta a la más ancha ---------------------------
  const placementOrder = [...admitted].sort((a, b) => {
    const ia = items[a];
    const ib = items[b];
    return (
      eligibleDays(ia).length - eligibleDays(ib).length ||
      PRIORITY_RANK[ia.priority] - PRIORITY_RANK[ib.priority] ||
      minutesOf(ib) - minutesOf(ia) ||
      a - b
    );
  });

  for (const index of placementOrder) {
    const item = items[index];
    const minutes = minutesOf(item);
    const heavy = isHeavy(item.estimateMin, item.priority);
    const eligible = eligibleDays(item);

    type Scored = { day: DayState; score: number; fits: boolean };
    const scoreOf = (day: DayState): Scored => {
      const after = load(day) + minutes;
      const fits = after <= day.capacity;
      // Parejo (ocupación y cantidad de cosas) y, a igualdad, mejor antes que después: una
      // tarea puesta el sábado tiene un solo intento, una puesta el martes tiene margen.
      let score = (after / day.capacity) * 100 + day.count * 8 + windowDays.indexOf(day.date) * EARLY_BIAS;
      if (heavy && day.heavyCount > 0) score += PENALTY_HEAVY;
      if (after > SOFT_CAP * day.capacity) score += PENALTY_SOFT_CAP + (after / day.capacity - SOFT_CAP) * 100;
      if (day.date === lightDate && after > LIGHT_LIMIT * day.capacity) score += PENALTY_LIGHT_DAY;
      return { day, score, fits };
    };

    const scored = eligible.map(scoreOf).filter((s) => s.fits);
    if (scored.length === 0) {
      const bestFreeMin = Math.max(0, ...eligible.map((day) => day.capacity - load(day)));
      deferred.push({
        index,
        item,
        code: "NO_ROOM",
        neededMin: minutes,
        freeMin: Math.round(bestFreeMin),
        suggestedDate: nextWeek
      });
      continue;
    }
    // Empate: el día más temprano (el orden de `eligible` ya es cronológico).
    const chosen = scored.reduce((best, s) => (s.score < best.score ? s : best));

    const reason = explain(item, chosen.day, eligible, heavy, minutes, lightDate);
    placed.push({ index, item, date: chosen.day.date, fixed: false, outsideWindow: false, reason });
    addToDay(chosen.day, item, minutes);
  }

  deferred.sort(
    (a, b) =>
      PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority] ||
      (a.item.deadline ?? "9999-12-31").localeCompare(b.item.deadline ?? "9999-12-31") ||
      a.index - b.index
  );
  placed.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);

  const dayPlans: DayPlan[] = windowDays.map((date) => {
    const day = days.get(date)!;
    // Índices sobre el orden final de `placed`. Una recurrencia aparece en cada día que le toca.
    const inThisDay = placed
      .map((p, i) => ({ p, i }))
      .filter(({ p }) =>
        p.reason.code === "RECURRING" ? (p.reason.dates ?? []).includes(date) : !p.outsideWindow && p.date === date
      )
      .map(({ i }) => i);
    const total = load(day);
    return {
      date,
      capacityMin: day.capacity,
      existingMin: day.existingMin,
      plannedMin: day.plannedMin,
      loadPct: day.capacity > 0 ? Math.round((total / day.capacity) * 100) : total > 0 ? 100 : 0,
      light: day.capacity > 0 && total / day.capacity <= LIGHT_LIMIT,
      heavy: day.heavyCount > 0,
      placed: inThisDay
    };
  });

  const warnings: WeekWarning[] = [];
  for (const day of dayPlans) {
    const total = day.existingMin + day.plannedMin;
    if (total > day.capacityMin) {
      warnings.push({ code: "OVERBOOKED_DAY", date: day.date, loadMin: total, capacityMin: day.capacityMin });
    }
  }
  if (usable.length >= 3 && !dayPlans.some((day) => day.light && day.capacityMin > 0)) {
    warnings.push({ code: "NO_LIGHT_DAY" });
  }
  for (const d of deferred) {
    if (d.item.deadline && d.item.deadline < nextWeek) {
      warnings.push({ code: "DEADLINE_AT_RISK", index: d.index, deadline: d.item.deadline });
    }
  }

  return { weekStart, days: dayPlans, placed, deferred, warnings };
}

/** La razón de una colocación flexible, medida con la carga de ANTES de colocarla. */
function explain(
  item: WeekItem,
  chosen: DayState,
  eligible: readonly DayState[],
  heavy: boolean,
  minutes: number,
  lightDate: string | null
): Reason {
  if (eligible.length === 1) {
    return item.deadline
      ? { code: "DEADLINE", date: chosen.date, deadline: item.deadline }
      : { code: "BEST_FIT", date: chosen.date, minutes: load(chosen) };
  }

  // El primer día que un criterio simple habría elegido y que se descartó.
  const earlier = eligible.find((day) => day.date < chosen.date);
  if (!earlier) return { code: "BEST_FIT", date: chosen.date, minutes: load(chosen) };

  const after = load(earlier) + minutes;
  const info = { date: earlier.date, minutes: load(earlier), title: biggest(earlier) };
  if (after > earlier.capacity) return { code: "FULL", ...info };
  if (heavy && earlier.heavyCount > 0 && chosen.heavyCount === 0) return { code: "HEAVY_CLASH", ...info };
  if (after > SOFT_CAP * earlier.capacity && load(chosen) + minutes <= SOFT_CAP * chosen.capacity) {
    return { code: "OVER_CAP", ...info };
  }
  if (earlier.date === lightDate) return { code: "KEEP_LIGHT", ...info };
  if (load(earlier) > load(chosen)) return { code: "BUSIER", ...info };
  return { code: "BEST_FIT", date: chosen.date, minutes: load(chosen) };
}
