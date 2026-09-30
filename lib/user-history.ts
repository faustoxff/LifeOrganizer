import "server-only";
import sql from "@/lib/db";
import { HISTORY_DAYS, computePatterns, normalizeCategory, type HistoryEntry, type UserPatterns } from "@/lib/user-patterns";

/**
 * Arma, por usuario, el historial de los últimos 90 días que alimenta a
 * `lib/user-patterns.ts`. Toda consulta filtra por `user_id`: un usuario nunca ve (ni
 * aprende de) los datos de otro.
 *
 * Entran las tareas (`kind = 'task'`) y las subtareas de proyecto. No los recordatorios
 * (un tilde no es trabajo), ni los proyectos en sí (su trabajo son sus subtareas), ni las
 * ocurrencias salteadas.
 */
export async function loadUserHistory(userId: string, now: Date = new Date()): Promise<HistoryEntry[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const sinceDay = since.toISOString().slice(0, 10);

  const [tasks, subtasks] = await Promise.all([
    sql`
      SELECT title, category, estimate_min, actual_min, done, completed_hour, postponed_count
      FROM tasks
      WHERE user_id = ${userId} AND kind = 'task' AND status <> 'skipped'
        AND ((done = TRUE AND completed_at >= ${since.toISOString()})
             OR (done = FALSE AND postponed_count > 0 AND due_date >= ${sinceDay}))
      ORDER BY created_at DESC
      LIMIT 1000
    `,
    sql`
      SELECT s.title, t.category, s.estimate_min, s.actual_min, s.done, s.completed_hour, s.postponed_count
      FROM subtasks s
      JOIN tasks t ON t.id = s.project_id AND t.user_id = s.user_id
      WHERE s.user_id = ${userId}
        AND ((s.done = TRUE AND s.done_at >= ${since.toISOString()})
             OR (s.done = FALSE AND s.postponed_count > 0))
      ORDER BY s.created_at DESC
      LIMIT 1000
    `
  ]);

  const positive = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const hour = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  };

  return [...tasks, ...subtasks].map((row) => ({
    title: String(row.title ?? ""),
    category: normalizeCategory(row.category as string | null),
    estimateMin: positive(row.estimate_min),
    actualMin: positive(row.actual_min),
    completed: row.done === true,
    completedHour: hour(row.completed_hour),
    postponedCount: Math.max(0, Number(row.postponed_count ?? 0) || 0)
  }));
}

/**
 * Un loader para UNA request: lee el historial la primera vez que se pide y reusa el
 * resultado. No hay cache entre requests ni entre usuarios (el loader nace con el
 * `userId`), así que no hay nada que se pueda cruzar.
 */
export function patternsLoader(userId: string, now: Date = new Date()): () => Promise<UserPatterns> {
  let cached: Promise<UserPatterns> | null = null;
  return () => {
    cached ??= loadUserHistory(userId, now).then(computePatterns);
    return cached;
  };
}
