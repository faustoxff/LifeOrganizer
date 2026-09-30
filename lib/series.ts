import { addDays, occurrencesBetween } from "@/lib/recurrence";
import type { RecurrenceRule, TaskPriority, TaskStatus } from "@/types/task";

/**
 * Orquestación de las series recurrentes, sin acceso a la base.
 *
 * Todo lo que toca datos pasa por un `store` inyectado. La implementación real
 * (SQL) está en lib/series-storage.ts; los tests usan una en memoria que respeta
 * el índice único (series_id, occurrence_date). Así la lógica que decide qué
 * crear, qué saltear y qué cortar se prueba sin una base.
 */

/** Cuántos días hacia adelante se materializan las ocurrencias. */
export const SERIES_WINDOW_DAYS = 14;

/** Tope de series activas por usuario, para todos los planes. */
export const MAX_SERIES_PER_USER = 30;

export interface SeriesRecord {
  id: string;
  userId: string;
  kind: "reminder" | "task";
  title: string;
  category: string;
  description: string;
  priority: TaskPriority;
  estimateMin: number;
  time: string | null;
  rule: RecurrenceRule;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
}

export interface OccurrenceStore {
  /** Series activas que pueden tener ocurrencias entre `from` y `to`. */
  listSeriesInWindow(userId: string, from: string, to: string): Promise<SeriesRecord[]>;
  /**
   * Inserta las ocurrencias que falten. Ignora las que ya existen (ON CONFLICT
   * DO NOTHING) y devuelve cuántas creó.
   */
  insertOccurrences(userId: string, series: SeriesRecord, dates: string[]): Promise<number>;
  /** Pasa a 'skipped' las ocurrencias pendientes de antes de `today`. */
  skipPastPending(userId: string, today: string): Promise<number>;
}

export type EnsureResult = { created: number; skipped: number };

/**
 * Deja al día las ocurrencias de un usuario: saltea las que quedaron atrás y
 * crea las que faltan de hoy a hoy + 14 días.
 *
 * Es idempotente: correrla dos veces (o dos requests a la vez) no duplica nada,
 * porque el store ignora lo que ya existe.
 */
export async function ensureOccurrencesWith(
  store: OccurrenceStore,
  userId: string,
  today: string,
  windowDays: number = SERIES_WINDOW_DAYS
): Promise<EnsureResult> {
  const skipped = await store.skipPastPending(userId, today);

  const to = addDays(today, windowDays);
  const seriesList = await store.listSeriesInWindow(userId, today, to);

  let created = 0;
  for (const series of seriesList) {
    if (!series.active) continue;
    const dates = occurrencesBetween(series.rule, series.startsOn, series.endsOn, today, to);
    if (dates.length === 0) continue;
    created += await store.insertOccurrences(userId, series, dates);
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Editar y borrar "esta y las siguientes"
// ---------------------------------------------------------------------------

export type OccurrenceRef = { seriesId: string; occurrenceDate: string; status: TaskStatus };

export interface SeriesEditStore {
  getOccurrence(userId: string, taskId: string): Promise<OccurrenceRef | null>;
  getSeries(userId: string, seriesId: string): Promise<SeriesRecord | null>;
  /** Termina la serie el día `endsOn`. Si ya no le queda ninguna fecha, `active` = false. */
  endSeries(userId: string, seriesId: string, endsOn: string, active: boolean): Promise<void>;
  /** Borra las ocurrencias de `fromDate` en adelante que no estén hechas. */
  deleteOccurrencesFrom(userId: string, seriesId: string, fromDate: string): Promise<number>;
  insertSeries(userId: string, series: SeriesRecord): Promise<void>;
  /** Marca una ocurrencia como salteada. Ver `deleteOnlyThis`. */
  skipOccurrence(userId: string, taskId: string): Promise<boolean>;
}

export type OccurrenceChanges = Partial<
  Pick<SeriesRecord, "title" | "category" | "description" | "priority" | "estimateMin" | "time" | "kind">
>;

export type FollowingResult =
  | { ok: true; seriesId: string }
  | { ok: false; reason: "not_found" | "not_pending" };

/**
 * Corta la serie el día anterior a la ocurrencia. Devuelve la serie ya cortada
 * y la fecha, o el motivo por el que no se puede.
 *
 * Una ocurrencia que ya no está pendiente (hecha o salteada) no se puede tomar
 * como punto de corte: la serie nueva arrancaría el mismo día y crearía un
 * duplicado de algo que ya pasó.
 */
async function cutSeries(store: SeriesEditStore, userId: string, taskId: string) {
  const occurrence = await store.getOccurrence(userId, taskId);
  if (!occurrence) return { ok: false, reason: "not_found" } as const;
  if (occurrence.status !== "pending") return { ok: false, reason: "not_pending" } as const;

  const found = await store.getSeries(userId, occurrence.seriesId);
  if (!found) return { ok: false, reason: "not_found" } as const;
  // Copia tomada ANTES de cortar: la serie nueva parte de cómo era la vieja, no
  // de cómo queda después de ponerle el ends_on.
  const series = { ...found, rule: { ...found.rule } };

  const endsOn = addDays(occurrence.occurrenceDate, -1);
  await store.endSeries(userId, series.id, endsOn, endsOn >= series.startsOn);
  await store.deleteOccurrencesFrom(userId, series.id, occurrence.occurrenceDate);

  return { ok: true, series, from: occurrence.occurrenceDate } as const;
}

/**
 * "Esta y las siguientes": la serie vieja termina el día anterior (ends_on), sus
 * ocurrencias futuras pendientes se borran y nace una serie nueva desde esa
 * fecha con los cambios. La regla se conserva; el llamador vuelve a materializar
 * las ocurrencias de la serie nueva.
 *
 * La fecha de arranque es siempre la de la ocurrencia editada, aunque el usuario
 * la haya movido: mover "esta y las siguientes" a otro día sería cambiar la
 * regla, y eso no se edita desde una ocurrencia.
 */
export async function editFollowing(
  store: SeriesEditStore,
  userId: string,
  taskId: string,
  changes: OccurrenceChanges,
  newSeriesId: string
): Promise<FollowingResult> {
  const cut = await cutSeries(store, userId, taskId);
  if (!cut.ok) return cut;

  const { series, from } = cut;
  await store.insertSeries(userId, {
    ...series,
    ...changes,
    id: newSeriesId,
    startsOn: from,
    active: true
  });
  return { ok: true, seriesId: newSeriesId };
}

/** "Esta y las siguientes" al borrar: corta la serie y no crea otra. */
export async function deleteFollowing(
  store: SeriesEditStore,
  userId: string,
  taskId: string
): Promise<FollowingResult> {
  const cut = await cutSeries(store, userId, taskId);
  if (!cut.ok) return cut;
  return { ok: true, seriesId: cut.series.id };
}

/**
 * "Solo esta" al borrar una ocurrencia: no se borra la fila, se marca salteada.
 *
 * Si se borrara, el siguiente `ensureOccurrences` la volvería a crear (la fecha
 * cae en la ventana y ya no existe). La fila salteada es la lápida que impide
 * que reaparezca, y sale de "Hoy" y del calendario igual que si no estuviera.
 */
export async function deleteOnlyThis(
  store: SeriesEditStore,
  userId: string,
  taskId: string
): Promise<boolean> {
  return store.skipOccurrence(userId, taskId);
}
