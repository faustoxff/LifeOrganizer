import type { Task } from "@/types/task";

/** Hasta este estimado (inclusive) una tarea se completa con un tilde, sin modo foco. */
export const FOCUS_MAX_QUICK_MIN = 15;

/**
 * El modo foco se ofrece solo donde tiene sentido: tareas (`kind: "task"`) de más de
 * 15 minutos. Un recordatorio no lleva foco, y un proyecto se trabaja por sus sesiones
 * (que sí lo tienen: son subtareas de proyecto y no pasan por acá).
 */
export function canFocusTask(task: Pick<Task, "kind" | "estimateMin" | "done">): boolean {
  return !task.done && task.kind === "task" && task.estimateMin > FOCUS_MAX_QUICK_MIN;
}
