import "server-only";
import { addExtraMinutes, draftProject, planProjects, progressOf, schedulerProjectFrom, sessionFromRecord, unprefixDraftSessions, DRAFT_PROJECT_ID } from "@/lib/project-scheduling";
import { inflationFor, type UserPatterns } from "@/lib/user-patterns";
import { patternsLoader } from "@/lib/user-history";
import { MAX_ACTIVE_PROJECTS, tomorrowOf, type DraftBody } from "@/lib/project-input";
import {
  applySubtaskPatch,
  createProject,
  loadProjectRecords,
  replaceSessions,
  setProjectDeadline,
  type ProjectRecord,
  type SubtaskPatch
} from "@/lib/projects-storage";
import type { ReplanOutput, Session } from "@/lib/scheduler";
import { loadTasks } from "@/lib/storage";
import {
  getAvailabilitySettings,
  getProjectsReplannedOn,
  markProjectsReplanned,
  saveAvailabilitySettings
} from "@/lib/user-settings";
import type { ProjectDraftPlan, ProjectSession, ProjectView } from "@/types/project";
import type { Task } from "@/types/task";
import type { Availability, AvailabilityOverrides } from "@/lib/availability";

/**
 * Orquesta la base y el scheduler para los proyectos de un usuario. Toda decisión de
 * fechas es del scheduler; acá solo se cargan datos, se le pasan y se guarda lo que
 * devuelve.
 */

export class ProjectLimitError extends Error {
  readonly limit = MAX_ACTIVE_PROJECTS;
  constructor() {
    super("PROJECT_LIMIT_REACHED");
    this.name = "ProjectLimitError";
  }
}

type State = {
  availability: Availability;
  overrides: AvailabilityOverrides;
  tasks: Task[];
  /** Lo aprendido del usuario: de ahí sale el factor de cada categoría. */
  patterns: UserPatterns;
  records: ProjectRecord[];
};

async function loadState(userId: string): Promise<State> {
  const [settings, tasks, patterns, records] = await Promise.all([
    getAvailabilitySettings(userId),
    loadTasks(userId),
    patternsLoader(userId)(),
    loadProjectRecords(userId)
  ]);
  return {
    availability: settings.availability,
    overrides: settings.overrides,
    tasks,
    patterns,
    records
  };
}

/** El factor de una categoría: el suyo si lo aprendió, si no el global, si no el default (1.3). */
const inflationOf = (state: Pick<State, "patterns">, category: string) => inflationFor(state.patterns.inflation, category).factor;

/** Un proyecto sigue en juego mientras no esté terminado y le quede algo por hacer. */
const isActive = (record: ProjectRecord) => !record.task.done && record.subtasks.some((s) => !s.done);

function planState(state: State, today: string, extra: ReturnType<typeof draftProject>[] = [], boost = 0): ReplanOutput {
  const active = state.records.filter(isActive);
  const boosted = boost > 0 ? addExtraMinutes(state.availability, state.overrides, boost) : null;
  return planProjects({
    today,
    availability: boosted?.availability ?? state.availability,
    overrides: boosted?.overrides ?? state.overrides,
    tasks: state.tasks,
    projects: [...active.map((r) => schedulerProjectFrom(r.task, r.subtasks, inflationOf(state, r.task.category))), ...extra],
    previousSessions: active.flatMap((r) => r.sessions.map(sessionFromRecord)),
    inflation: inflationOf(state, "general")
  });
}

const sessionKey = (s: { subtaskId: string; date: string; minutes: number }) => `${s.subtaskId}|${s.date}|${s.minutes}`;

/** Guarda el plan si difiere de lo guardado. Devuelve si escribió algo. */
async function persist(userId: string, state: State, result: ReplanOutput): Promise<boolean> {
  const active = state.records.filter(isActive);
  const stored = state.records.flatMap((r) => r.sessions);
  const same =
    stored.length === result.sessions.length &&
    new Set(stored.map(sessionKey)).size === new Set(result.sessions.map(sessionKey)).size &&
    result.sessions.every((s) => stored.some((t) => sessionKey(t) === sessionKey(s)));
  if (same) return false;

  // Los proyectos terminados dejan de tener agenda.
  const ids = [...new Set([...active.map((r) => r.task.id), ...state.records.filter((r) => r.sessions.length > 0).map((r) => r.task.id)])];
  await replaceSessions(userId, ids, result.sessions);
  return true;
}

function toViews(state: State, result: ReplanOutput): ProjectView[] {
  const planned = new Map<string, Session[]>();
  for (const s of result.sessions) planned.set(s.projectId, [...(planned.get(s.projectId) ?? []), s]);

  return state.records.map((record) => {
    const id = record.task.id;
    const active = isActive(record);
    const sessions: ProjectSession[] = active
      ? (planned.get(id) ?? []).map((s) => ({
          id: `${s.subtaskId}:${s.date}`,
          projectId: s.projectId,
          subtaskId: s.subtaskId,
          date: s.date,
          minutes: s.minutes,
          part: s.part,
          totalParts: s.totalParts
        }))
      : [];
    return {
      task: record.task,
      contextSummary: record.contextSummary,
      subtasks: record.subtasks,
      sessions,
      plan: active ? (result.perProject[id] ?? null) : null,
      warnings: result.warnings.filter((w) => w.projectId === id),
      progress: progressOf(record.subtasks)
    };
  });
}

/** Replanifica y guarda. Se usa una vez por día al cargar y al completar o saltear una subtarea. */
async function replanAndPersist(userId: string, today: string): Promise<{ state: State; result: ReplanOutput }> {
  const state = await loadState(userId);
  const result = planState(state, today);
  await persist(userId, state, result);
  return { state, result };
}

/** Una vez por día por usuario. Idempotente: el plan es estable, así que repetirlo no mueve nada. */
export async function ensureDailyReplan(userId: string, today: string): Promise<boolean> {
  if ((await getProjectsReplannedOn(userId)) === today) return false;
  await replanAndPersist(userId, today);
  await markProjectsReplanned(userId, today);
  return true;
}

/** Los proyectos del usuario con su agenda y cómo viene el plan. */
export async function listProjects(userId: string, today: string): Promise<ProjectView[]> {
  await ensureDailyReplan(userId, today);
  const state = await loadState(userId);
  return toViews(state, planState(state, today));
}

/**
 * El plan que resultaría de crear este proyecto, sin guardar nada. Los proyectos que
 * ya existen conservan su agenda y el nuevo se acomoda alrededor.
 */
export async function previewDraft(
  userId: string,
  today: string,
  draft: Pick<DraftBody, "deadline" | "dailyCapMin" | "subtasks" | "extraMinPerDay">
): Promise<ProjectDraftPlan> {
  const state = await loadState(userId);
  const result = planState(state, today, [draftProject(draft.deadline, draft.dailyCapMin, draft.subtasks, inflationOf(state, "general"))], draft.extraMinPerDay);
  return {
    subtasks: draft.subtasks,
    sessions: unprefixDraftSessions(result.sessions),
    plan: result.perProject[DRAFT_PROJECT_ID],
    warnings: result.warnings.filter((w) => w.projectId === DRAFT_PROJECT_ID || w.projectId === undefined),
    inflation: inflationOf(state, "general")
  };
}

/** Crea el proyecto. El servidor recalcula el plan: nunca se confía en sesiones del cliente. */
export async function createFromDraft(userId: string, today: string, draft: DraftBody): Promise<ProjectView[]> {
  const state = await loadState(userId);
  if (state.records.filter(isActive).length >= MAX_ACTIVE_PROJECTS) throw new ProjectLimitError();

  const projectId = crypto.randomUUID();
  const idByTemp = new Map(draft.subtasks.map((s) => [s.tempId, crypto.randomUUID()]));
  const totalEstimate = draft.subtasks.reduce((sum, s) => sum + s.estimateMin, 0);

  const task: Task = {
    id: projectId,
    title: draft.title,
    category: "general",
    description: draft.description,
    priority: "medium",
    estimateMin: Math.min(1440, Math.max(1, totalEstimate)),
    dueDate: draft.deadline,
    done: false,
    status: "pending",
    kind: "project",
    ...(draft.dailyCapMin ? { dailyCapMin: draft.dailyCapMin } : {})
  };
  const subtasks = draft.subtasks.map((s, position) => ({
    id: idByTemp.get(s.tempId) as string,
    title: s.title,
    estimateMin: s.estimateMin,
    dependsOn: s.dependsOn.map((d) => idByTemp.get(d) as string),
    position,
    deliverable: s.deliverable
  }));

  await createProject(userId, { task, contextSummary: draft.contextSummary, subtasks });

  // "More minutes per day" was the user's choice on the preview; it is saved with the
  // project because the plan they confirmed depends on it.
  let availability = state.availability;
  let overrides = state.overrides;
  if (draft.extraMinPerDay > 0) {
    const boosted = addExtraMinutes(state.availability, state.overrides, draft.extraMinPerDay);
    availability = boosted.availability;
    overrides = boosted.overrides;
    await saveAvailabilitySettings(userId, availability, overrides);
  }

  const fresh = await loadState(userId);
  const result = planState({ ...fresh, availability, overrides }, today);
  await persist(userId, fresh, result);
  return toViews(fresh, result);
}

export async function applySubtaskAction(
  userId: string,
  today: string,
  subtaskId: string,
  action: { action: "complete"; actualMin: number | null } | { action: "progress"; minutes: number } | { action: "skip" },
  /** Hora local (0-23) del usuario ahora: se guarda al completar. */
  localHour: number | null = null
): Promise<{ views: ProjectView[]; projectDone: boolean } | null> {
  const patch: SubtaskPatch =
    action.action === "skip"
      ? { action: "skip", notBefore: tomorrowOf(today) }
      : action.action === "complete"
        ? { ...action, completedHour: localHour }
        : action;
  const applied = await applySubtaskPatch(userId, subtaskId, patch);
  if (!applied) return null;

  const { state, result } = await replanAndPersist(userId, today);
  return { views: toViews(state, result), projectDone: applied.projectDone };
}

/** Mueve la fecha límite (la opción "correr fecha") y replanifica. */
export async function moveDeadline(userId: string, today: string, projectId: string, deadline: string): Promise<ProjectView[] | null> {
  if (!(await setProjectDeadline(userId, projectId, deadline))) return null;
  const { state, result } = await replanAndPersist(userId, today);
  return toViews(state, result);
}

/** Suma minutos por día a la disponibilidad (la opción "más minutos por día") y replanifica. */
export async function addDailyMinutes(userId: string, today: string, extraMin: number): Promise<ProjectView[]> {
  const state = await loadState(userId);
  const boosted = addExtraMinutes(state.availability, state.overrides, extraMin);
  await saveAvailabilitySettings(userId, boosted.availability, boosted.overrides);
  const { state: fresh, result } = await replanAndPersist(userId, today);
  return toViews(fresh, result);
}
