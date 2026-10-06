import type { TaskKind } from "@/types/task";

type Labels = { createTask: string; createReminder: string; createProject: string };

/**
 * Título de la tarjeta de confirmación del chat: "Crear recordatorio", "Crear tarea (3)", "Crear proyecto"…
 * Si todos los ítems son del mismo tipo usa el nombre de ese tipo (con la cantidad entre paréntesis si hay más de
 * uno); si hay tipos mezclados, el texto genérico "Crear N elementos".
 */
export function createCardTitle(
  kinds: readonly TaskKind[],
  labels: Labels,
  createAll: (count: number) => string
): string {
  const count = kinds.length;
  if (count === 0) return labels.createTask;
  const first = kinds[0];
  if (kinds.some((kind) => kind !== first)) return createAll(count);
  const label = first === "reminder" ? labels.createReminder : first === "project" ? labels.createProject : labels.createTask;
  return count === 1 ? label : `${label} (${count})`;
}
