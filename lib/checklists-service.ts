import "server-only";
import { detectActivity, normalizeTitle } from "@/lib/activity";
import {
  addItemToList,
  applyOp,
  buildSnapshot,
  mergeLearning,
  type ChecklistItem,
  type ChecklistOp,
  type TaskChecklist,
  type Weather
} from "@/lib/checklist";
import { MAX_TITLES_PER_BATCH } from "@/lib/checklist-ai";
import type { ChecklistPromptInput } from "@/lib/checklist-prompts";
import { daysBetween } from "@/lib/recurrence";
import { hemisphereOf, seasonOf } from "@/lib/season";
import { selectRelevantFacts, type UserFact } from "@/lib/user-facts";
import type { AppLanguage } from "@/lib/i18n";
import type { TaskKind } from "@/types/task";

/**
 * Orquesta las checklists: detectar la actividad de una tarea, armar la checklist de una
 * ocurrencia, editarla y aprender al completarla. Todo lo que toca afuera (base, IA, clima,
 * cuota) entra por `ChecklistDeps`, así el flujo se prueba entero sin red y sin base.
 */

export type StoredListLike = { id: string; activityKey: string; seriesId: string | null; items: ChecklistItem[] };

export type TaskRecord = {
  id: string;
  title: string;
  kind: TaskKind;
  dueDate: string;
  seriesId: string | null;
  done: boolean;
  checklist: TaskChecklist | null;
};

export type ChecklistStore = {
  loadTask(userId: string, taskId: string): Promise<TaskRecord | null>;
  saveTaskChecklist(userId: string, taskId: string, checklist: TaskChecklist | null): Promise<void>;
  loadList(userId: string, activityKey: string, seriesId: string | null): Promise<StoredListLike | null>;
  saveList(userId: string, activityKey: string, seriesId: string | null, items: readonly ChecklistItem[]): Promise<void>;
  loadTitleActivities(userId: string, titles: readonly string[]): Promise<Map<string, string>>;
  saveTitleActivities(userId: string, entries: ReadonlyArray<{ title: string; activityKey: string }>): Promise<void>;
  listFacts(userId: string): Promise<UserFact[]>;
  getLocation(userId: string): Promise<{ lat: number; lon: number } | null>;
};

export type ChecklistDeps = {
  store: ChecklistStore;
  now: () => Date;
  /** Cuenta un uso de IA. false = se acabó la cuota de hoy. */
  gate: (kind: "checklist_generate" | "checklist_detect") => Promise<boolean>;
  generate: (input: ChecklistPromptInput) => Promise<ChecklistItem[]>;
  classify: (titles: string[]) => Promise<Map<string, string | null>>;
  weather: (place: { lat: number; lon: number }, date: string, daysAhead: number) => Promise<Weather | null>;
};

export type ChecklistContext = { userId: string; timeZone: string; today: string; language: AppLanguage };

// ---------------------------------------------------------------------------
// Detectar
// ---------------------------------------------------------------------------

/**
 * La actividad de cada tarea. Orden: lo que el usuario descartó o la IA ya clasificó (caché
 * por título), las reglas, y por último una sola llamada de IA para los títulos que quedan.
 * Un proyecto nunca es una actividad. Sin cuota o si la IA falla, esos títulos quedan sin
 * actividad y se vuelven a intentar la próxima vez (no se guarda un "no" que no fue un no).
 */
export async function detectActivities(
  ctx: ChecklistContext,
  tasks: ReadonlyArray<{ id: string; title: string; kind: TaskKind }>,
  deps: ChecklistDeps
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const eligible = tasks.filter((t) => t.kind !== "project");
  for (const task of tasks) result[task.id] = null;

  const titles = [...new Set(eligible.map((t) => normalizeTitle(t.title)).filter(Boolean))];
  const known = await deps.store.loadTitleActivities(ctx.userId, titles);

  const byTitle = new Map<string, string | null>();
  const unknown: string[] = [];
  for (const title of titles) {
    const cached = known.get(title);
    if (cached !== undefined) {
      byTitle.set(title, cached === "" ? null : cached);
      continue;
    }
    const rule = detectActivity(title);
    if (rule) byTitle.set(title, rule);
    else unknown.push(title);
  }

  if (unknown.length > 0 && (await deps.gate("checklist_detect"))) {
    try {
      const asked = unknown.slice(0, MAX_TITLES_PER_BATCH);
      const classified = await deps.classify(asked);
      const toSave: Array<{ title: string; activityKey: string }> = [];
      // Solo lo que se preguntó: una respuesta con títulos de más no se guarda.
      for (const title of asked) {
        const key = classified.get(title) ?? null;
        byTitle.set(title, key);
        toSave.push({ title, activityKey: key ?? "" });
      }
      await deps.store.saveTitleActivities(ctx.userId, toSave);
    } catch (error) {
      console.warn("[checklists] activity classification failed, will retry next time", error);
    }
  }

  for (const task of eligible) result[task.id] = byTitle.get(normalizeTitle(task.title)) ?? null;
  return result;
}

/** La actividad de una sola tarea, sin IA: caché y reglas. */
async function activityOf(ctx: ChecklistContext, task: TaskRecord, deps: ChecklistDeps): Promise<string | null> {
  if (task.kind === "project") return null;
  const title = normalizeTitle(task.title);
  const cached = (await deps.store.loadTitleActivities(ctx.userId, [title])).get(title);
  if (cached !== undefined) return cached === "" ? null : cached;
  return detectActivity(title);
}

// ---------------------------------------------------------------------------
// Armar la checklist de una ocurrencia
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { status: "ok"; checklist: TaskChecklist; /** La IA no pudo o no había cuota: viene vacía y el usuario la arma. */ degraded?: "limit" | "ai_failed" }
  | { status: "no_task" }
  | { status: "no_activity" };

async function contextFor(ctx: ChecklistContext, task: TaskRecord, deps: ChecklistDeps) {
  const season = seasonOf(task.dueDate, hemisphereOf(ctx.timeZone));
  const place = await deps.store.getLocation(ctx.userId);
  // Sin ubicación no hay clima: se omite, no se adivina.
  const weather = place ? await deps.weather(place, task.dueDate, daysBetween(ctx.today, task.dueDate)) : null;
  return { season, weather };
}

export async function resolveChecklist(ctx: ChecklistContext, taskId: string, deps: ChecklistDeps): Promise<ResolveResult> {
  const task = await deps.store.loadTask(ctx.userId, taskId);
  if (!task) return { status: "no_task" };
  // Ya armada: no se vuelve a armar (el clima y la lista de ese día quedan fijos).
  if (task.checklist) return { status: "ok", checklist: task.checklist };

  const activity = await activityOf(ctx, task, deps);
  if (!activity) return { status: "no_activity" };

  const { season, weather } = await contextFor(ctx, task, deps);
  let stored = await deps.store.loadList(ctx.userId, activity, task.seriesId);
  let degraded: "limit" | "ai_failed" | undefined;

  if (!stored) {
    if (!(await deps.gate("checklist_generate"))) {
      degraded = "limit";
    } else {
      try {
        const facts = selectRelevantFacts(await deps.store.listFacts(ctx.userId), `${activity} ${task.title}`, 6);
        const items = await deps.generate({ activityKey: activity, title: task.title, facts, season, weather, language: ctx.language });
        await deps.store.saveList(ctx.userId, activity, task.seriesId, items);
        stored = { id: "", activityKey: activity, seriesId: task.seriesId, items };
      } catch (error) {
        console.warn("[checklists] could not generate the initial list", error);
        degraded = "ai_failed";
      }
    }
  }

  const checklist = buildSnapshot(activity, stored?.items ?? [], { season, weather }, deps.now());
  // Una lista vacía por un fallo no se guarda: la próxima vez se vuelve a intentar.
  if (!degraded) await deps.store.saveTaskChecklist(ctx.userId, taskId, checklist);
  return { status: "ok", checklist, ...(degraded ? { degraded } : {}) };
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

export type EditResult =
  | { status: "ok"; checklist: TaskChecklist }
  | { status: "no_task" | "no_activity" }
  | { status: "invalid"; reason: "empty" | "not_found" | "limit" };

export async function editChecklist(
  ctx: ChecklistContext,
  taskId: string,
  change: ChecklistOp,
  deps: ChecklistDeps
): Promise<EditResult> {
  const task = await deps.store.loadTask(ctx.userId, taskId);
  if (!task) return { status: "no_task" };

  let current = task.checklist;
  if (!current) {
    // Editar no gasta IA: si todavía no hay checklist se parte de la lista guardada (o de nada).
    const activity = await activityOf(ctx, task, deps);
    if (!activity) return { status: "no_activity" };
    const { season, weather } = await contextFor(ctx, task, deps);
    const stored = await deps.store.loadList(ctx.userId, activity, task.seriesId);
    current = buildSnapshot(activity, stored?.items ?? [], { season, weather }, deps.now());
  }

  const result = applyOp(current, change);
  if (!result.ok) return { status: "invalid", reason: result.reason };
  await deps.store.saveTaskChecklist(ctx.userId, taskId, result.checklist);

  // Lo que el usuario agrega entra a la lista guardada en el momento: es lo más fuerte que dice.
  if (result.added) {
    const stored = await deps.store.loadList(ctx.userId, result.checklist.activityKey, task.seriesId);
    const items = addItemToList(stored?.items ?? [], result.added, deps.now());
    await deps.store.saveList(ctx.userId, result.checklist.activityKey, stored ? stored.seriesId : task.seriesId, items);
  }
  return { status: "ok", checklist: result.checklist };
}

/** "Esto no es una actividad": ese título no vuelve a tener checklist y se borra la de esta tarea. */
export async function dismissActivity(ctx: ChecklistContext, taskId: string, deps: ChecklistDeps): Promise<boolean> {
  const task = await deps.store.loadTask(ctx.userId, taskId);
  if (!task) return false;
  await deps.store.saveTitleActivities(ctx.userId, [{ title: normalizeTitle(task.title), activityKey: "" }]);
  await deps.store.saveTaskChecklist(ctx.userId, taskId, null);
  return true;
}

// ---------------------------------------------------------------------------
// Aprender
// ---------------------------------------------------------------------------

/**
 * Al completar una tarea con checklist: suma usos a lo que quedó, cuenta lo que se sacó y
 * borra lo que se sacó tres veces seguidas. Una sola vez por ocurrencia (`learnedAt`).
 */
export async function learnFromCompletion(userId: string, taskId: string, deps: Pick<ChecklistDeps, "store" | "now">): Promise<boolean> {
  const task = await deps.store.loadTask(userId, taskId);
  const checklist = task?.checklist;
  if (!task || !checklist || checklist.learnedAt || !task.done) return false;

  const stored = await deps.store.loadList(userId, checklist.activityKey, task.seriesId);
  const merged = mergeLearning(stored?.items ?? [], checklist, deps.now());
  await deps.store.saveList(userId, checklist.activityKey, stored ? stored.seriesId : task.seriesId, merged);
  await deps.store.saveTaskChecklist(userId, taskId, { ...checklist, learnedAt: deps.now().toISOString() });
  return true;
}
