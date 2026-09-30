import type { Task } from "@/types/task";

/**
 * Qué tareas ve el usuario y dónde. Puro y sin fechas implícitas: `today` viene
 * de afuera (del dispositivo en el cliente, de la zona del usuario en el
 * servidor), así que lo mismo se puede probar y no depende del reloj.
 */

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Una ocurrencia que el usuario dejó pasar. No cuenta como vencida ni suma nada. */
export function isSkipped(task: Pick<Task, "status">): boolean {
  return task.status === "skipped";
}

/** Ocurrencia de una serie cuya fecha todavía no llegó: se ve en el calendario, no en "Hoy". */
export function isFutureOccurrence(task: Pick<Task, "seriesId" | "dueDate">, today: string): boolean {
  return Boolean(task.seriesId) && task.dueDate > today;
}

/**
 * Lo que sale en la lista principal: todo lo pendiente salvo lo salteado y las
 * ocurrencias futuras de series (esas viven en el calendario).
 */
export function isVisibleInToday(task: Task, today: string = localToday()): boolean {
  return !task.done && !isSkipped(task) && !isFutureOccurrence(task, today);
}

/** Puede ser "la tarea recomendada": los recordatorios no compiten, tienen su lugar aparte. */
export function isRecommendable(task: Task, today: string = localToday()): boolean {
  return isVisibleInToday(task, today) && task.kind !== "reminder";
}

/** "Recordatorios de hoy": pendientes de hoy o vencidos, por fecha y hora. */
export function getTodayReminders(tasks: Task[], today: string = localToday()): Task[] {
  return tasks
    .filter((task) => task.kind === "reminder" && isVisibleInToday(task, today) && task.dueDate <= today)
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
    });
}

/** Fechas de las ocurrencias salteadas: días que ni suman a la racha ni la cortan. */
export function getSkippedDates(tasks: Task[]): string[] {
  const dates = new Set<string>();
  for (const task of tasks) {
    if (isSkipped(task) && task.occurrenceDate) dates.add(task.occurrenceDate);
  }
  return [...dates];
}
