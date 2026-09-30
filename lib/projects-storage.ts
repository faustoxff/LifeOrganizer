import "server-only";
import sql from "@/lib/db";
import type { Completion } from "@/lib/ai/types";
import type { Session } from "@/lib/scheduler";
import { normalizeTask } from "@/lib/storage";
import type { ProjectSession, ProjectSubtask } from "@/types/project";
import type { Task } from "@/types/task";

/**
 * Acceso a proyectos, subtareas y sesiones. Toda consulta filtra por user_id: un id
 * de proyecto o de subtarea de otro usuario no encuentra nada. Las fechas se leen con
 * `::text` (ver lib/storage.ts).
 */

export type ProjectRecord = {
  task: Task;
  contextSummary: string;
  subtasks: ProjectSubtask[];
  sessions: ProjectSession[];
};

type SubtaskRow = {
  id: string;
  project_id: string;
  title: string;
  estimate_min: number | null;
  depends_on: string[] | null;
  position: number;
  done: boolean;
  done_at: string | null;
  actual_min: number | null;
  deliverable: boolean;
  not_before: string | null;
  scheduled_date: string | null;
};

type SessionRow = {
  id: string;
  project_id: string;
  subtask_id: string;
  date: string;
  minutes: number;
  part: number;
  total_parts: number;
};

function toSubtask(row: SubtaskRow): ProjectSubtask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    estimateMin: row.estimate_min ?? 30,
    dependsOn: row.depends_on ?? [],
    position: row.position,
    done: row.done,
    deliverable: row.deliverable,
    ...(row.done_at ? { doneAt: row.done_at } : {}),
    ...(row.actual_min !== null ? { actualMin: row.actual_min } : {}),
    ...(row.not_before ? { notBefore: row.not_before } : {}),
    ...(row.scheduled_date ? { scheduledDate: row.scheduled_date } : {})
  };
}

function toSession(row: SessionRow): ProjectSession {
  return {
    id: row.id,
    projectId: row.project_id,
    subtaskId: row.subtask_id,
    date: row.date,
    minutes: row.minutes,
    part: row.part,
    totalParts: row.total_parts
  };
}

/** Todos los proyectos del usuario con sus subtareas y su agenda. */
export async function loadProjectRecords(userId: string): Promise<ProjectRecord[]> {
  const [taskRows, subtaskRows, sessionRows] = await Promise.all([
    sql`
      SELECT id, user_id, title, category, description, priority, estimate_min, due_date, done,
             completed_at, steps, kind, remind_at, series_id,
             occurrence_date::text AS occurrence_date, status, daily_cap_min, context_summary
      FROM tasks
      WHERE user_id = ${userId} AND kind = 'project'
      ORDER BY created_at DESC
    `,
    sql`
      SELECT id, project_id, title, estimate_min, depends_on, position, done, done_at, actual_min,
             deliverable, not_before::text AS not_before, scheduled_date::text AS scheduled_date
      FROM subtasks
      WHERE user_id = ${userId}
      ORDER BY position ASC, created_at ASC
    `,
    sql`
      SELECT id, project_id, subtask_id, date::text AS date, minutes, part, total_parts
      FROM project_sessions
      WHERE user_id = ${userId}
      ORDER BY date ASC
    `
  ]);

  const subtasks = (subtaskRows as SubtaskRow[]).map(toSubtask);
  const sessions = (sessionRows as SessionRow[]).map(toSession);

  const records: ProjectRecord[] = [];
  for (const row of taskRows) {
    const task = normalizeTask(row);
    if (!task) continue;
    records.push({
      task,
      contextSummary: typeof row.context_summary === "string" ? row.context_summary : "",
      subtasks: subtasks.filter((s) => s.projectId === task.id),
      sessions: sessions.filter((s) => s.projectId === task.id)
    });
  }
  return records;
}

export type NewProject = {
  task: Task;
  contextSummary: string;
  subtasks: Array<Pick<ProjectSubtask, "id" | "title" | "estimateMin" | "dependsOn" | "position" | "deliverable">>;
};

/**
 * Crea la tarea del proyecto y sus subtareas en una sola transacción: o queda todo o
 * no queda nada. Las sesiones se guardan aparte, con `replaceSessions`.
 */
export async function createProject(userId: string, project: NewProject): Promise<void> {
  const { task, subtasks } = project;
  await sql.transaction([
    sql`
      INSERT INTO tasks (id, user_id, title, category, description, priority, duration, estimate_min,
                         due_date, done, status, steps, kind, daily_cap_min, context_summary)
      VALUES (${task.id}, ${userId}, ${task.title}, ${task.category}, ${task.description},
              ${task.priority}, 'long', ${task.estimateMin}, ${task.dueDate}, FALSE, 'pending', '[]'::jsonb,
              'project', ${task.dailyCapMin ?? null}, ${project.contextSummary || null})
    `,
    sql`
      INSERT INTO subtasks (id, project_id, user_id, title, estimate_min, depends_on, position, deliverable)
      SELECT s.id, ${task.id}::text, ${userId}::text, s.title, s.est,
             ARRAY(SELECT jsonb_array_elements_text(s.deps::jsonb)), s.pos, s.deliverable
      FROM unnest(
        ${subtasks.map((s) => s.id)}::text[],
        ${subtasks.map((s) => s.title)}::text[],
        ${subtasks.map((s) => s.estimateMin)}::int[],
        ${subtasks.map((s) => JSON.stringify(s.dependsOn))}::text[],
        ${subtasks.map((s) => s.position)}::int[],
        ${subtasks.map((s) => s.deliverable)}::bool[]
      ) AS s(id, title, est, deps, pos, deliverable)
    `
  ]);
}

/**
 * Reemplaza la agenda de estos proyectos por `sessions` y deja `scheduled_date` de
 * cada subtarea en la fecha de su primera sesión. Una transacción: nunca queda una
 * agenda a medias.
 */
export async function replaceSessions(
  userId: string,
  projectIds: string[],
  sessions: readonly Session[]
): Promise<void> {
  if (projectIds.length === 0) return;
  await sql.transaction([
    sql`DELETE FROM project_sessions WHERE user_id = ${userId} AND project_id = ANY(${projectIds}::text[])`,
    sql`
      INSERT INTO project_sessions (id, user_id, project_id, subtask_id, date, minutes, part, total_parts)
      SELECT s.id, ${userId}::text, s.project_id, s.subtask_id, s.day, s.minutes, s.part, s.total
      FROM unnest(
        ${sessions.map(() => crypto.randomUUID())}::text[],
        ${sessions.map((s) => s.projectId)}::text[],
        ${sessions.map((s) => s.subtaskId)}::text[],
        ${sessions.map((s) => s.date)}::date[],
        ${sessions.map((s) => s.minutes)}::int[],
        ${sessions.map((s) => s.part)}::int[],
        ${sessions.map((s) => s.totalParts)}::int[]
      ) AS s(id, project_id, subtask_id, day, minutes, part, total)
    `,
    sql`
      UPDATE subtasks st
      SET scheduled_date = first.first_date
      FROM (
        SELECT subtask_id, MIN(date) AS first_date
        FROM project_sessions
        WHERE user_id = ${userId} AND project_id = ANY(${projectIds}::text[])
        GROUP BY subtask_id
      ) first
      WHERE st.id = first.subtask_id AND st.user_id = ${userId}
    `,
    sql`
      UPDATE subtasks
      SET scheduled_date = NULL
      WHERE user_id = ${userId} AND project_id = ANY(${projectIds}::text[])
        AND id NOT IN (
          SELECT subtask_id FROM project_sessions
          WHERE user_id = ${userId} AND project_id = ANY(${projectIds}::text[])
        )
    `
  ]);
}

/** Cambia la fecha límite (y con ella el plan, que quien llama recalcula). */
export async function setProjectDeadline(userId: string, projectId: string, deadline: string): Promise<boolean> {
  const rows = await sql`
    UPDATE tasks SET due_date = ${deadline}
    WHERE id = ${projectId} AND user_id = ${userId} AND kind = 'project'
    RETURNING id
  `;
  return rows.length > 0;
}

export type SubtaskPatch =
  | { action: "complete"; actualMin: number | null; /** Hora local (0-23) del usuario al completar. */ completedHour?: number | null }
  | { action: "progress"; minutes: number }
  | { action: "skip"; notBefore: string };

/** Aplica una acción a una subtarea. Devuelve el proyecto al que pertenece, o null si no es del usuario. */
export async function applySubtaskPatch(
  userId: string,
  subtaskId: string,
  patch: SubtaskPatch
): Promise<{ projectId: string; projectDone: boolean } | null> {
  let rows;
  if (patch.action === "complete") {
    rows = await sql`
      UPDATE subtasks
      SET done = TRUE, done_at = NOW(),
          completed_hour = ${patch.completedHour ?? null}::smallint,
          actual_min = CASE WHEN ${patch.actualMin}::int IS NULL THEN actual_min
                            ELSE COALESCE(actual_min, 0) + ${patch.actualMin}::int END
      WHERE id = ${subtaskId} AND user_id = ${userId}
      RETURNING project_id
    `;
  } else if (patch.action === "progress") {
    rows = await sql`
      UPDATE subtasks
      SET actual_min = COALESCE(actual_min, 0) + ${patch.minutes}::int
      WHERE id = ${subtaskId} AND user_id = ${userId} AND done = FALSE
      RETURNING project_id
    `;
  } else {
    rows = await sql`
      UPDATE subtasks
      SET not_before = ${patch.notBefore}::date,
          -- saltear es mover a un día posterior; saltear dos veces el mismo día no suma dos
          postponed_count = postponed_count
            + CASE WHEN not_before IS NULL OR ${patch.notBefore}::date > not_before THEN 1 ELSE 0 END
      WHERE id = ${subtaskId} AND user_id = ${userId} AND done = FALSE
      RETURNING project_id
    `;
  }

  const projectId = rows[0]?.project_id as string | undefined;
  if (!projectId) return null;

  // Terminar la última subtarea termina el proyecto.
  let projectDone = false;
  if (patch.action === "complete") {
    const left = await sql`
      SELECT COUNT(*) AS count FROM subtasks
      WHERE user_id = ${userId} AND project_id = ${projectId} AND done = FALSE
    `;
    if (Number(left[0]?.count ?? 1) === 0) {
      await sql`
        UPDATE tasks SET done = TRUE, completed_at = NOW(), status = 'done'
        WHERE id = ${projectId} AND user_id = ${userId} AND kind = 'project' AND done = FALSE
      `;
      projectDone = true;
    }
  }
  return { projectId, projectDone };
}

/**
 * Los días (UTC, "YYYY-MM-DD") en que el usuario terminó alguna subtarea de proyecto.
 * Un día de trabajo en un proyecto es un día de trabajo: cuenta para la racha igual
 * que una tarea suelta.
 */
export async function loadSubtaskDoneDays(userId: string): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT (done_at AT TIME ZONE 'UTC')::date::text AS day
    FROM subtasks
    WHERE user_id = ${userId} AND done = TRUE AND done_at IS NOT NULL
    ORDER BY day DESC
    LIMIT 1000
  `;
  return rows.map((r) => String(r.day));
}

/** Anota los tokens de una llamada de IA de proyectos. */
export async function logAiTokens(userId: string, kind: string, completion: Completion): Promise<void> {
  await sql`
    INSERT INTO ai_token_log (user_id, kind, provider, model, input_tokens, output_tokens)
    VALUES (${userId}, ${kind}, ${completion.provider}, ${completion.model},
            ${completion.usage.inputTokens}, ${completion.usage.outputTokens})
  `;
}
