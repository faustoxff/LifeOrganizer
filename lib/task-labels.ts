import { AppLanguage, copy } from "@/lib/i18n";
import { formatMinutes } from "@/lib/task-estimate";
import { Task } from "@/types/task";

/** "45 min", "2 h". Las unidades son las mismas en todos los idiomas. */
export function getTaskDurationLabel(estimateMin: number) {
  return formatMinutes(estimateMin);
}

export function getTaskPriorityLabel(priority: Task["priority"], language: AppLanguage) {
  return copy[language].taskForm.priorities[priority];
}
