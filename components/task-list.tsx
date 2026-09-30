"use client";

import { AnimatePresence, motion } from "motion/react";
import { useAppLanguage } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDueDate, getDueDateLabel } from "@/lib/task-date";
import { getTaskDurationLabel, getTaskPriorityLabel } from "@/lib/task-labels";
import { cn } from "@/lib/utils";
import { Task } from "@/types/task";

type TaskListProps = {
  completedTasks: Task[];
  isMutating?: boolean;
  pendingTasks: Task[];
  onDeleteTask: (taskId: string) => Promise<void>;
  onEditTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => Promise<void>;
};

export function TaskList({
  completedTasks,
  isMutating = false,
  pendingTasks,
  onDeleteTask,
  onEditTask,
  onToggleTask
}: TaskListProps) {
  const { copy } = useAppLanguage();

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-lg">
      <div className="flex flex-col gap-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {copy.taskList.title}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {copy.taskList.subtitle}
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <TaskGroup
            emptyMessage={copy.taskList.noPending}
            isMutating={isMutating}
            tasks={pendingTasks}
            title={copy.taskList.pending}
            onDeleteTask={onDeleteTask}
            onEditTask={onEditTask}
            onToggleTask={onToggleTask}
          />
          <TaskGroup
            emptyMessage={copy.taskList.noCompleted}
            isMutating={isMutating}
            tasks={completedTasks}
            title={copy.taskList.completed}
            onDeleteTask={onDeleteTask}
            onEditTask={onEditTask}
            onToggleTask={onToggleTask}
          />
        </div>
      </div>
    </section>
  );
}

type TaskGroupProps = {
  emptyMessage: string;
  isMutating: boolean;
  tasks: Task[];
  title: string;
  onDeleteTask: (taskId: string) => Promise<void>;
  onEditTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => Promise<void>;
};

function TaskGroup({
  emptyMessage,
  isMutating,
  tasks,
  title,
  onDeleteTask,
  onEditTask,
  onToggleTask
}: TaskGroupProps) {
  const { copy, language } = useAppLanguage();

  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <Badge variant="secondary"><AnimatedNumber value={tasks.length} /></Badge>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {tasks.map((task) => (
              <motion.li
                key={task.id}
                initial={{ opacity: 0, scale: 0.85, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: -8 }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
              >
                <Card className="p-4">
                  <div className="flex flex-col gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start">
                    <div className="min-w-0 pr-0 sm:pr-2">
                      <p className={cn("text-sm font-semibold", task.done && "line-through text-muted-foreground")}>
                        {task.title}
                      </p>
                      {task.description ? (
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          {task.description}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {task.category} · {getTaskPriorityLabel(task.priority, language)} ·{" "}
                        {getTaskDurationLabel(task.estimateMin)} · {getDueDateLabel(task.dueDate, language)} ·{" "}
                        {formatDueDate(task.dueDate, language)}
                      </p>
                    </div>

                    <div className="grid w-full shrink-0 gap-2 sm:w-40">
                      <Button
                        disabled={isMutating}
                        onClick={() => onEditTask(task.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {copy.taskList.edit}
                      </Button>
                      <Button
                        disabled={isMutating}
                        onClick={() => void onToggleTask(task.id)}
                        size="sm"
                        type="button"
                        variant={task.done ? "secondary" : "default"}
                      >
                        {task.done ? copy.taskList.markPending : copy.taskList.markDone}
                      </Button>
                      <Button
                        disabled={isMutating}
                        onClick={() => void onDeleteTask(task.id)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {copy.common.delete}
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
