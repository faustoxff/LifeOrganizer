import "server-only";
import sql from "@/lib/db";
import { parseStoredRule } from "@/lib/recurrence";
import {
  ensureOccurrencesWith,
  type EnsureResult,
  type OccurrenceStore,
  type OccurrenceRef,
  type SeriesEditStore,
  type SeriesRecord
} from "@/lib/series";
import { durationFromMinutes } from "@/lib/task-estimate";
import { normalizeTask } from "@/lib/storage";
import type { Task, TaskPriority, TaskStatus } from "@/types/task";

/**
 * Acceso a task_series y a las ocurrencias. Toda consulta filtra por user_id:
 * un id de serie o de tarea de otro usuario simplemente no encuentra nada.
 * Las fechas se leen con `::text` (ver lib/storage.ts).
 */

type SeriesRow = {
  id: string;
  user_id: string;
  kind: "reminder" | "task";
  title: string;
  category: string;
  description: string;
  priority: TaskPriority;
  estimate_min: number;
  time: string | null;
  rule: unknown;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
};

function toSeries(row: SeriesRow | undefined): SeriesRecord | null {
  if (!row) return null;
  const rule = parseStoredRule(row.rule);
  // Una regla ilegible no debe tumbar la carga de todas las tareas: esa serie
  // simplemente deja de generar ocurrencias.
  if (!rule) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    category: row.category,
    description: row.description,
    priority: row.priority,
    estimateMin: row.estimate_min,
    time: row.time,
    rule,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    active: row.active
  };
}

export async function insertSeries(userId: string, series: SeriesRecord): Promise<void> {
  await sql`
    INSERT INTO task_series (id, user_id, kind, title, category, description, priority,
                             estimate_min, time, rule, starts_on, ends_on, active)
    VALUES (${series.id}, ${userId}, ${series.kind}, ${series.title}, ${series.category},
            ${series.description}, ${series.priority}, ${series.estimateMin}, ${series.time},
            ${JSON.stringify(series.rule)}::jsonb, ${series.startsOn}::date,
            ${series.endsOn}::date, ${series.active})
  `;
}

export async function countActiveSeries(userId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*) AS count FROM task_series WHERE user_id = ${userId} AND active = TRUE
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function loadSeries(userId: string, seriesId: string): Promise<SeriesRecord | null> {
  const rows = await sql`
    SELECT id, user_id, kind, title, category, description, priority, estimate_min, time, rule,
           starts_on::text AS starts_on, ends_on::text AS ends_on, active
    FROM task_series
    WHERE id = ${seriesId} AND user_id = ${userId}
  `;
  return toSeries(rows[0] as SeriesRow | undefined);
}

/** Las ocurrencias de una serie, para devolverlas al crearla. */
export async function loadSeriesOccurrences(userId: string, seriesId: string): Promise<Task[]> {
  const rows = await sql`
    SELECT id, user_id, title, category, description, priority, estimate_min, due_date,
           done, completed_at, steps, kind, remind_at, series_id,
           occurrence_date::text AS occurrence_date, status, daily_cap_min
    FROM tasks
    WHERE user_id = ${userId} AND series_id = ${seriesId}
    ORDER BY occurrence_date ASC
  `;
  return rows.map(normalizeTask).filter((t): t is Task => t !== null);
}

const occurrenceStore: OccurrenceStore & SeriesEditStore = {
  async listSeriesInWindow(userId, from, to) {
    const rows = await sql`
      SELECT id, user_id, kind, title, category, description, priority, estimate_min, time, rule,
             starts_on::text AS starts_on, ends_on::text AS ends_on, active
      FROM task_series
      WHERE user_id = ${userId} AND active = TRUE
        AND starts_on <= ${to}::date
        AND (ends_on IS NULL OR ends_on >= ${from}::date)
    `;
    return rows.map((row) => toSeries(row as SeriesRow)).filter((s): s is SeriesRecord => s !== null);
  },

  async insertOccurrences(userId, series, dates) {
    if (dates.length === 0) return 0;
    const ids = dates.map(() => crypto.randomUUID());
    const rows = await sql`
      INSERT INTO tasks (id, user_id, title, category, description, priority, duration, estimate_min,
                         due_date, done, status, steps, kind, remind_at, series_id, occurrence_date)
      SELECT o.id, ${userId}::text, ${series.title}::text, ${series.category}::text,
             ${series.description}::text, ${series.priority}::text,
             ${durationFromMinutes(series.estimateMin)}::text, ${series.estimateMin}::integer,
             o.day::text, FALSE, 'pending', '[]'::jsonb, ${series.kind}::text, ${series.time}::text,
             ${series.id}::text, o.day
      FROM unnest(${ids}::text[], ${dates}::date[]) AS o(id, day)
      ON CONFLICT (series_id, occurrence_date) WHERE series_id IS NOT NULL DO NOTHING
      RETURNING id
    `;
    return rows.length;
  },

  async skipPastPending(userId, today) {
    const rows = await sql`
      UPDATE tasks
      SET status = 'skipped'
      WHERE user_id = ${userId} AND series_id IS NOT NULL AND status = 'pending'
        AND occurrence_date < ${today}::date
      RETURNING id
    `;
    return rows.length;
  },

  async getOccurrence(userId, taskId) {
    const rows = await sql`
      SELECT series_id, occurrence_date::text AS occurrence_date, status, daily_cap_min
      FROM tasks
      WHERE id = ${taskId} AND user_id = ${userId} AND series_id IS NOT NULL
    `;
    const row = rows[0] as
      | { series_id: string; occurrence_date: string; status: TaskStatus }
      | undefined;
    if (!row || !row.occurrence_date) return null;
    return {
      seriesId: row.series_id,
      occurrenceDate: row.occurrence_date,
      status: row.status
    } satisfies OccurrenceRef;
  },

  getSeries: (userId, seriesId) => loadSeries(userId, seriesId),

  async endSeries(userId, seriesId, endsOn, active) {
    await sql`
      UPDATE task_series
      SET ends_on = ${endsOn}::date, active = ${active}
      WHERE id = ${seriesId} AND user_id = ${userId}
    `;
  },

  async deleteOccurrencesFrom(userId, seriesId, fromDate) {
    const rows = await sql`
      DELETE FROM tasks
      WHERE user_id = ${userId} AND series_id = ${seriesId}
        AND occurrence_date >= ${fromDate}::date AND status <> 'done'
      RETURNING id
    `;
    return rows.length;
  },

  insertSeries,

  async skipOccurrence(userId, taskId) {
    const rows = await sql`
      UPDATE tasks
      SET status = 'skipped', done = FALSE, completed_at = NULL
      WHERE id = ${taskId} AND user_id = ${userId} AND series_id IS NOT NULL
      RETURNING id
    `;
    return rows.length > 0;
  }
};

export { occurrenceStore as seriesStore };

/** Deja al día las ocurrencias del usuario. Se llama al cargar sus tareas. */
export function ensureOccurrences(userId: string, today: string): Promise<EnsureResult> {
  return ensureOccurrencesWith(occurrenceStore, userId, today);
}
