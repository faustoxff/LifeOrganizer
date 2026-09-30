import { detectActivity } from "@/lib/activity";
import { REMOVE_AFTER_SKIPS, type ChecklistItem } from "@/lib/checklist";
import { addDays } from "@/lib/recurrence";
import { selectRelevantFacts, type UserFact } from "@/lib/user-facts";
import type { Task } from "@/types/task";

/**
 * Lo que Milo sabe del usuario en un turno: los hechos que vienen al caso y las listas de
 * "no te olvides" de las actividades de las que se habla. Puro; la lectura de la base está
 * en `lib/personal-context-server.ts`. Ver "Milo y las recomendaciones" en docs/roadmap.md.
 */

export const MAX_HINT_ACTIVITIES = 3;
export const MAX_HINT_ITEMS = 6;
const HISTORY_TURNS = 4;
const UPCOMING_DAYS = 7;
const MAX_TASK_TITLES = 10;

export type ChecklistHint = { activityKey: string; items: string[] };

/** El texto contra el que se mide qué hechos vienen al caso: la conversación y lo que viene. */
export function conversationText(input: {
  message: string;
  history?: ReadonlyArray<{ content: string }>;
  tasks?: readonly Task[];
  today: string;
}): string {
  const horizon = addDays(input.today, UPCOMING_DAYS);
  const titles = (input.tasks ?? [])
    .filter((t) => !t.done && t.status !== "skipped" && t.dueDate <= horizon)
    .slice(0, MAX_TASK_TITLES)
    .map((t) => t.title);
  const recent = (input.history ?? []).slice(-HISTORY_TURNS).map((m) => m.content);
  return [input.message, ...recent, ...titles].join("\n");
}

export function pickFacts(facts: readonly UserFact[], text: string): UserFact[] {
  return selectRelevantFacts(facts, text);
}

/** Actividades de las que se habla: las del mensaje primero, después las de las tareas de esta semana. */
export function activitiesInPlay(input: { message: string; tasks?: readonly Task[]; today: string }): string[] {
  const found: string[] = [];
  const add = (key: string | null) => {
    if (key && !found.includes(key)) found.push(key);
  };
  add(detectActivity(input.message));
  const horizon = addDays(input.today, UPCOMING_DAYS);
  for (const task of input.tasks ?? []) {
    if (task.done || task.status === "skipped" || task.kind === "project" || task.dueDate > horizon) continue;
    add(detectActivity(task.title));
  }
  return found.slice(0, MAX_HINT_ACTIVITIES);
}

/** Lo más usado de una lista, sin lo condicional (época/clima) ni lo que ya se descartó. */
export function hintFromList(activityKey: string, items: readonly ChecklistItem[]): ChecklistHint | null {
  const base = items
    .filter((i) => !i.season && !i.weather && i.skips < REMOVE_AFTER_SKIPS)
    .sort((a, b) => b.uses - a.uses || a.skips - b.skips)
    .slice(0, MAX_HINT_ITEMS)
    .map((i) => i.text);
  return base.length > 0 ? { activityKey, items: base } : null;
}
