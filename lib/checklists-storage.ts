import "server-only";
import sql from "@/lib/db";
import { readTaskChecklist, sanitizeItems, type ChecklistItem, type TaskChecklist } from "@/lib/checklist";
import type { TaskKind } from "@/types/task";

/**
 * Listas de "no te olvides", sus snapshots por ocurrencia y la caché de actividades. Toda
 * consulta filtra por `user_id`.
 */

export type StoredList = { id: string; activityKey: string; seriesId: string | null; items: ChecklistItem[] };

type ListRow = { id: string; activity_key: string; series_id: string | null; items: unknown };
const toList = (row: ListRow): StoredList => ({
  id: row.id,
  activityKey: row.activity_key,
  seriesId: row.series_id,
  items: sanitizeItems(row.items)
});

/**
 * La lista que corresponde: la de la serie si esa serie tiene la suya; si no, la de la
 * actividad; y para una tarea suelta (sin serie), la que haya de esa actividad, aunque
 * haya nacido ligada a una serie: el gimnasio del martes y "ir al gimnasio" hoy son la misma
 * actividad. Una serie nunca usa la lista de otra serie.
 */
export async function loadList(userId: string, activityKey: string, seriesId: string | null): Promise<StoredList | null> {
  const rows = await sql`
    SELECT id, activity_key, series_id, items FROM activity_checklists
    WHERE user_id = ${userId} AND activity_key = ${activityKey}
      AND (series_id IS NULL OR series_id = ${seriesId}::text OR ${seriesId}::text IS NULL)
    ORDER BY CASE WHEN series_id = ${seriesId}::text THEN 0 WHEN series_id IS NULL THEN 1 ELSE 2 END,
             updated_at DESC
    LIMIT 1
  `;
  return rows[0] ? toList(rows[0] as ListRow) : null;
}

export async function saveList(
  userId: string,
  activityKey: string,
  seriesId: string | null,
  items: readonly ChecklistItem[]
): Promise<void> {
  await sql`
    INSERT INTO activity_checklists (id, user_id, activity_key, series_id, items, updated_at)
    VALUES (${crypto.randomUUID()}, ${userId}, ${activityKey}, ${seriesId}, ${JSON.stringify(items)}::jsonb, NOW())
    ON CONFLICT (user_id, activity_key, (COALESCE(series_id, '')))
    DO UPDATE SET items = EXCLUDED.items, updated_at = NOW()
  `;
}

export async function listLists(userId: string): Promise<StoredList[]> {
  const rows = await sql`
    SELECT id, activity_key, series_id, items FROM activity_checklists
    WHERE user_id = ${userId} ORDER BY updated_at DESC
  `;
  return (rows as ListRow[]).map(toList);
}

export async function deleteList(userId: string, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM activity_checklists WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

export async function deleteAllLists(userId: string): Promise<number> {
  const rows = await sql`DELETE FROM activity_checklists WHERE user_id = ${userId} RETURNING id`;
  return rows.length;
}

// --- La checklist de una ocurrencia -----------------------------------------------------

export type TaskForChecklist = {
  id: string;
  title: string;
  kind: TaskKind;
  dueDate: string;
  seriesId: string | null;
  done: boolean;
  checklist: TaskChecklist | null;
};

export async function loadTaskForChecklist(userId: string, taskId: string): Promise<TaskForChecklist | null> {
  const rows = await sql`
    SELECT id, title, kind, due_date::text AS due_date, series_id, done, checklist
    FROM tasks WHERE id = ${taskId} AND user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    kind: row.kind as TaskKind,
    dueDate: row.due_date as string,
    seriesId: (row.series_id as string | null) ?? null,
    done: row.done as boolean,
    checklist: readTaskChecklist(row.checklist)
  };
}

export async function saveTaskChecklist(userId: string, taskId: string, checklist: TaskChecklist | null): Promise<void> {
  await sql`
    UPDATE tasks SET checklist = ${checklist ? JSON.stringify(checklist) : null}::jsonb
    WHERE id = ${taskId} AND user_id = ${userId}
  `;
}

// --- Caché de actividades por título -----------------------------------------------------

/** Lo que ya se sabe de estos títulos. '' significa "no es una actividad". */
export async function loadTitleActivities(userId: string, titles: readonly string[]): Promise<Map<string, string>> {
  if (titles.length === 0) return new Map();
  const rows = await sql`
    SELECT title_norm, activity_key FROM activity_titles
    WHERE user_id = ${userId} AND title_norm = ANY(${titles as string[]})
  `;
  return new Map((rows as Array<{ title_norm: string; activity_key: string }>).map((r) => [r.title_norm, r.activity_key]));
}

export async function saveTitleActivities(userId: string, entries: ReadonlyArray<{ title: string; activityKey: string }>): Promise<void> {
  if (entries.length === 0) return;
  await sql`
    INSERT INTO activity_titles (user_id, title_norm, activity_key)
    SELECT ${userId}, t.title, t.key
    FROM unnest(${entries.map((e) => e.title)}::text[], ${entries.map((e) => e.activityKey)}::text[]) AS t(title, key)
    ON CONFLICT (user_id, title_norm) DO UPDATE SET activity_key = EXCLUDED.activity_key
  `;
}

export async function deleteAllTitleActivities(userId: string): Promise<void> {
  await sql`DELETE FROM activity_titles WHERE user_id = ${userId}`;
}
