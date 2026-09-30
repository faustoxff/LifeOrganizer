"use client";

import { CheckCircle2, SkipForward, X } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { formatPlanDate, PlanByDay, PlanSummary } from "@/components/project-plan-view";
import { Button } from "@/components/ui/button";
import { getDateLocale } from "@/lib/i18n";
import type { ProjectView } from "@/types/project";

type Props = {
  view: ProjectView;
  disabled?: boolean;
  onClose: () => void;
  onComplete: (subtaskId: string, actualMin: number | null) => void;
  onSkip: (subtaskId: string) => void;
  onMoveDeadline: (projectId: string, deadline: string) => void;
  onAddMinutes: (extraMin: number) => void;
};

/** El plan completo de un proyecto: progreso, margen que queda y cada sesión por día. */
export function ProjectDetail({ view, disabled = false, onClose, onComplete, onSkip, onMoveDeadline, onAddMinutes }: Props) {
  const { copy, language } = useAppLanguage();
  const locale = getDateLocale(language);
  const { task, subtasks, sessions, plan, progress } = view;
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const totalMin = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const done = subtasks.filter((s) => s.done);
  const titleOf = (id: string) => subtasks.find((s) => s.id === id)?.title ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="project-detail-title" className="relative my-4 w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-lg">
        <Button variant="ghost" size="icon" onClick={onClose} className="absolute right-3 top-3 h-8 w-8 rounded-full" aria-label={copy.common.close}>
          <X className="h-4 w-4" />
        </Button>

        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{copy.project.detailTitle}</p>
        <h2 id="project-detail-title" className="mt-1 pr-8 text-lg font-semibold tracking-tight">{task.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{formatPlanDate(task.dueDate, locale)}</p>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">{copy.project.progressLabel}</span>
            <span className="tabular-nums">{progress.done}/{progress.total}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {plan && <PlanSummary plan={plan} totalMin={totalMin} className="mt-4" />}

        {plan && !plan.feasible && (
          <div role="alert" className="mt-4 flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">{copy.project.notFitTitle}</p>
            <p>{copy.project.shortfall(plan.shortfallMin)}</p>
            <div className="flex flex-wrap gap-2">
              {plan.options?.achievableDeadline && (
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => onMoveDeadline(task.id, plan.options?.achievableDeadline as string)}>
                  {copy.project.optDate(formatPlanDate(plan.options.achievableDeadline, locale))}
                </Button>
              )}
              {plan.options?.extraMinPerDay != null && (
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAddMinutes(plan.options?.extraMinPerDay as number)}>
                  {copy.project.optExtra(plan.options.extraMinPerDay)}
                </Button>
              )}
            </div>
          </div>
        )}
        {plan && plan.feasible && plan.bufferConsumedPct > 50 && (
          <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">{copy.project.tightNote}</p>
        )}

        <div className="mt-5">
          {sessions.length > 0 ? (
            <PlanByDay
              sessions={sessions}
              titleOf={titleOf}
              actions={(session) => (
                <span className="flex flex-shrink-0 gap-0.5">
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={disabled} onClick={() => onComplete(session.subtaskId, null)} aria-label={`${copy.project.done}: ${titleOf(session.subtaskId)}`}>
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={disabled} onClick={() => onSkip(session.subtaskId)} aria-label={`${copy.project.skipToday}: ${titleOf(session.subtaskId)}`}>
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </span>
              )}
            />
          ) : null}
        </div>

        {done.length > 0 && (
          <ul className="mt-5 flex flex-col gap-1 text-sm text-muted-foreground">
            {done.map((s) => (
              <li key={s.id} className="flex items-center gap-2 line-through">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
                {s.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
