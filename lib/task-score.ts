import { Task } from "@/types/task";
import { getDaysUntilDueDate } from "@/lib/task-date";
import { durationFromMinutes } from "@/lib/task-estimate";
import { isRecommendable } from "@/lib/task-views";

type ScoredTask = Pick<Task, "priority" | "estimateMin" | "dueDate">;

export const priorityPoints = {
  low: 2,
  medium: 5,
  high: 8
};

// Los cortes salen de los minutos (<=20 corta, <=75 media, el resto larga), los
// mismos que usa la columna `duration` derivada. Puntúa lo mismo que antes para
// las tareas que ya existían: el backfill las llevó a 15/45/120.
const durationPoints = {
  short: 0,
  medium: 2,
  long: 5
};

/** `today` ("YYYY-MM-DD") es obligatorio en el servidor; el cliente puede omitirlo. */
export function getTaskScore(task: ScoredTask, today?: string) {
  return getTaskScoreWithContext(task, { hasCriticalTasks: false, today });
}

/**
 * La tarea de mayor puntaje, sin mirar el reloj. La recomendación "para ahora" (que sí
 * considera el tiempo libre y los compromisos) es `getRecommendedTask` en lib/recommendation.ts.
 */
export function getTopScoredTask(tasks: Task[], today?: string) {
  const pendingTasks = tasks.filter((task) => isRecommendable(task, today));

  if (pendingTasks.length === 0) {
    return null;
  }

  const hasCriticalTasks = pendingTasks.some((task) => isCriticalTask(task, today));

  const sortedTasks = [...pendingTasks].sort((leftTask, rightTask) => {
    const leftScore = getTaskScoreWithContext(leftTask, { hasCriticalTasks, today });
    const rightScore = getTaskScoreWithContext(rightTask, { hasCriticalTasks, today });

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    const leftTaskDueDays = getDaysUntilDueDate(leftTask.dueDate, today);
    const rightTaskDueDays = getDaysUntilDueDate(rightTask.dueDate, today);

    if (leftTaskDueDays !== rightTaskDueDays) {
      return leftTaskDueDays - rightTaskDueDays;
    }

    if (leftTask.priority !== rightTask.priority) {
      return priorityPoints[rightTask.priority] - priorityPoints[leftTask.priority];
    }

    if (leftTask.estimateMin !== rightTask.estimateMin) {
      return (
        getDurationPoints(rightTask.estimateMin, rightTaskDueDays, hasCriticalTasks) -
        getDurationPoints(leftTask.estimateMin, leftTaskDueDays, hasCriticalTasks)
      );
    }

    return leftTask.title.localeCompare(rightTask.title);
  });

  return sortedTasks[0];
}

export function getUrgencyPoints(daysUntilDueDate: number) {
  if (daysUntilDueDate <= 0) {
    return 18;
  }

  if (daysUntilDueDate === 1) {
    return 16;
  }

  if (daysUntilDueDate <= 3) {
    return 11;
  }

  if (daysUntilDueDate <= 7) {
    return 5;
  }

  return 0;
}

function getDurationPoints(
  estimateMin: number,
  daysUntilDueDate: number,
  hasCriticalTasks: boolean
) {
  const duration = durationFromMinutes(estimateMin);
  let score = durationPoints[duration];

  if (duration === "long") {
    if (daysUntilDueDate <= 3) {
      score += 6;
    } else if (daysUntilDueDate <= 7) {
      score += 4;
    } else {
      score += 2;
    }
  }

  if (duration === "medium" && daysUntilDueDate > 7) {
    score += 1;
  }

  if (duration === "short" && daysUntilDueDate > 7 && !hasCriticalTasks) {
    score += 3;
  }

  return score;
}

export function getTaskScoreWithContext(
  task: ScoredTask,
  context: { hasCriticalTasks: boolean; today?: string }
) {
  const daysUntilDueDate = getDaysUntilDueDate(task.dueDate, context.today);
  let score = 0;

  score += priorityPoints[task.priority];
  score += getUrgencyPoints(daysUntilDueDate);
  score += getDurationPoints(task.estimateMin, daysUntilDueDate, context.hasCriticalTasks);

  return score;
}

export function isCriticalTask(task: ScoredTask, today?: string) {
  const daysUntilDueDate = getDaysUntilDueDate(task.dueDate, today);

  return (
    daysUntilDueDate <= 3 ||
    task.priority === "high" ||
    (durationFromMinutes(task.estimateMin) === "long" && daysUntilDueDate <= 7)
  );
}
