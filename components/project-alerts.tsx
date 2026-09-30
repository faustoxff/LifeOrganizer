"use client";

import { AlertTriangle } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { formatPlanDate } from "@/components/project-plan-view";
import { getDateLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ProjectView } from "@/types/project";

type Props = {
  projects: readonly ProjectView[];
  disabled?: boolean;
  onOpen: (projectId: string) => void;
  onMoveDeadline: (projectId: string, deadline: string) => void;
  onAddMinutes: (extraMin: number) => void;
};

/** Cuántos avisos se muestran a la vez; el resto se ve en el detalle del proyecto. */
const MAX_ALERTS = 2;

/**
 * Aviso cuando un plan viene justo (TIGHT) o ya no entra (INFEASIBLE), con acciones
 * concretas: ver el plan, correr la fecha o sumar minutos por día.
 */
export function ProjectAlerts({ projects, disabled = false, onOpen, onMoveDeadline, onAddMinutes }: Props) {
  const { copy, language } = useAppLanguage();
  const locale = getDateLocale(language);

  const alerts = projects
    .filter((p) => p.plan && (!p.plan.feasible || p.plan.bufferConsumedPct > 50))
    // Lo que no entra primero.
    .sort((a, b) => Number(a.plan?.feasible) - Number(b.plan?.feasible))
    .slice(0, MAX_ALERTS);

  if (alerts.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-border">
      {alerts.map((view) => {
        const plan = view.plan!;
        const infeasible = !plan.feasible;
        return (
          <div
            key={view.task.id}
            role="alert"
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs sm:px-5",
              infeasible ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {infeasible ? copy.project.infeasibleAlert(view.task.title) : copy.project.tightAlert(view.task.title)}
            </span>
            <span className="flex flex-wrap items-center gap-3 font-semibold">
              {infeasible && plan.options?.achievableDeadline && (
                <button disabled={disabled} className="underline underline-offset-2 disabled:opacity-50" onClick={() => onMoveDeadline(view.task.id, plan.options?.achievableDeadline as string)}>
                  {copy.project.optDate(formatPlanDate(plan.options.achievableDeadline, locale))}
                </button>
              )}
              {infeasible && plan.options?.extraMinPerDay != null && (
                <button disabled={disabled} className="underline underline-offset-2 disabled:opacity-50" onClick={() => onAddMinutes(plan.options?.extraMinPerDay as number)}>
                  {copy.project.optExtra(plan.options.extraMinPerDay)}
                </button>
              )}
              <button className="underline underline-offset-2" onClick={() => onOpen(view.task.id)}>
                {copy.project.viewPlan}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
