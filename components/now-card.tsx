"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Clock, Coffee, Play, RefreshCw, Sparkles, Shirt } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { PriorityPill } from "@/components/priority-pill";
import { Button } from "@/components/ui/button";
import { formatLocalTime } from "@/lib/busy-blocks";
import { canFocusTask } from "@/lib/focus-eligibility";
import { focusCopy } from "@/lib/focus-copy";
import { nowCopy, reasonLine, windowLine } from "@/lib/now-copy";
import type { NowChoice, NowView } from "@/lib/use-now";
import { getDueDateLabel } from "@/lib/task-date";
import { formatMinutes } from "@/lib/task-estimate";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

const CHOICES: { id: NowChoice; label: "m15" | "m30" | "h1" | "more" }[] = [
  { id: "15", label: "m15" },
  { id: "30", label: "m30" },
  { id: "60", label: "h1" },
  { id: "more", label: "more" }
];

type Props = {
  view: NowView;
  allTasks: readonly Task[];
  isMutating: boolean;
  breakingDownTaskId: string | null;
  onFocusTask: (id: string) => void;
  onBreakDown: (id: string) => void;
  onToggleTask: (id: string) => Promise<void>;
  onEditTask: (id: string) => void;
  onStartSession: (subtaskId: string) => void;
  /** La checklist de la actividad (la misma que dentro de la tarea), para la tarjeta de "prepárate". */
  renderTaskExtra?: (task: Task) => ReactNode;
};

/**
 * La tarjeta de "hoy": cuánto tiempo libre hay ahora, qué conviene hacer con él y por qué (una línea).
 * La elección la hace `lib/recommendation.ts`; acá solo se muestra y se corrige a mano.
 */
export function NowCard({ view, allTasks, isMutating, breakingDownTaskId, onFocusTask, onBreakDown, onToggleTask, onEditTask, onStartSession, renderTaskExtra }: Props) {
  const { language, copy } = useAppLanguage();
  const t = nowCopy(language);
  const focusT = focusCopy[language];
  const { current, window: win, timeZone } = view;

  const realTask =
    current.type === "task" && !current.task.id.startsWith("session:") ? allTasks.find((task) => task.id === current.task.id) ?? null : null;
  const sessionId = current.type === "task" && current.task.id.startsWith("session:") ? current.task.id.slice("session:".length) : null;
  const blockTask =
    current.type === "prepare" && current.reason.block?.id.startsWith("task:")
      ? allTasks.find((task) => `task:${task.id}` === current.reason.block?.id) ?? null
      : null;

  return (
    <motion.section
      key={`${current.type}:${current.type === "task" ? current.task.id : ""}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      aria-label={t.title}
      data-testid="now-card"
      className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4"
    >
      {/* Cuánto tiempo hay */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/20 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary">
          <Clock className="h-3 w-3" />
          {t.title}
        </span>
        <p className="text-xs font-semibold text-primary/90" data-testid="now-window">
          {windowLine(t, win, timeZone)}
        </p>
      </div>

      {/* Corregir a mano */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t.chips.manual}>
        {CHOICES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={view.manual === id}
            onClick={() => view.setManual(id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              view.manual === id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {t.chips[label]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={view.tired}
          onClick={view.toggleTired}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            view.tired ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {t.chips.tired}
        </button>
        {view.manual && (
          <button type="button" onClick={() => view.setManual(null)} className="px-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
            {t.chips.auto}
          </button>
        )}
      </div>

      {/* Qué hacer */}
      {current.type === "task" ? (
        <div className="mt-3">
          <p className="text-lg font-semibold leading-snug tracking-tight sm:text-xl">{current.task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {realTask && (
              <>
                <span>{realTask.category}</span>
                <span>·</span>
                <span>{getDueDateLabel(realTask.dueDate, language)}</span>
                <PriorityPill priority={realTask.priority} language={language} />
              </>
            )}
            <span className="font-medium text-primary/90" data-testid="now-minutes">
              {current.mode === "advance" ? t.advance(formatMinutes(current.minutes)) : t.finish(formatMinutes(current.minutes))}
            </span>
          </div>
          {realTask?.steps && realTask.steps.length > 0 && (
            <p className="mt-2 text-xs font-medium text-primary/90">
              {realTask.steps.filter((s) => s.done).length}/{realTask.steps.length} ·{" "}
              {realTask.steps.find((s) => !s.done)?.text ?? copy.taskList.completed}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2.5">
          {current.type === "prepare" ? <Shirt className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" /> : <Coffee className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />}
          <div>
            <p className="text-lg font-semibold leading-snug tracking-tight">{current.type === "prepare" ? t.prepare.title : t.rest.title}</p>
            {current.type === "prepare" && current.reason.block && (
              <p className="text-xs text-muted-foreground">
                {t.prepare.text(current.reason.block.title, formatLocalTime(current.reason.block.start, timeZone))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* La razón, siempre en una línea */}
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-foreground/80" data-testid="now-reason">
        {reasonLine(t, current, timeZone)}
      </p>

      {/* Checklist de la actividad, si existe */}
      {blockTask && renderTaskExtra && <div className="mt-2">{renderTaskExtra(blockTask)}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        {realTask && canFocusTask(realTask) && (
          <Button size="sm" onClick={() => onFocusTask(realTask.id)} className="gap-1.5">
            <Play className="h-4 w-4" />
            {focusT.focus}
          </Button>
        )}
        {sessionId && (
          <Button size="sm" onClick={() => onStartSession(sessionId)} className="gap-1.5">
            <Play className="h-4 w-4" />
            {focusT.focus}
          </Button>
        )}
        {realTask && !realTask.steps?.length && (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={breakingDownTaskId === realTask.id} onClick={() => onBreakDown(realTask.id)}>
            <Sparkles className="h-4 w-4" />
            {breakingDownTaskId === realTask.id ? focusT.breaking : focusT.breakDown}
          </Button>
        )}
        {realTask && (
          <>
            <Button size="sm" variant="outline" disabled={isMutating} onClick={() => void onToggleTask(realTask.id)} className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              {copy.taskList.markDone}
            </Button>
            <Button size="sm" variant="ghost" disabled={isMutating} onClick={() => onEditTask(realTask.id)}>
              {copy.taskList.edit}
            </Button>
          </>
        )}
        {view.options.length > 1 && (
          <Button size="sm" variant="ghost" onClick={view.other} className="gap-1.5" data-testid="now-other">
            <RefreshCw className="h-4 w-4" />
            {t.chips.other}
          </Button>
        )}
      </div>
    </motion.section>
  );
}
