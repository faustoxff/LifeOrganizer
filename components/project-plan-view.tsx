"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { getDateLocale } from "@/lib/i18n";
import { groupByDay, totalHours } from "@/lib/project-scheduling";
import type { ProjectPlan } from "@/lib/scheduler";
import { cn } from "@/lib/utils";

type PlanSession = { subtaskId: string; date: string; minutes: number; part: number; totalParts: number };

/** "mié, 30 sep". */
function dayLabel(date: string, locale: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

export function formatPlanDate(date: string, locale: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" });
}

/** Total de trabajo, fecha estimada de fin y días de margen. */
export function PlanSummary({ plan, totalMin, className }: { plan: ProjectPlan; totalMin: number; className?: string }) {
  const { copy, language } = useAppLanguage();
  const locale = getDateLocale(language);
  return (
    <dl className={cn("grid grid-cols-3 gap-3 rounded-xl border border-border bg-card p-3 text-center", className)}>
      <div>
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{copy.project.totalWork}</dt>
        <dd className="mt-0.5 text-base font-semibold tabular-nums">{totalHours(totalMin)} h</dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{copy.project.finishOn}</dt>
        <dd className="mt-0.5 text-base font-semibold">
          {plan.plannedEndDate ? formatPlanDate(plan.plannedEndDate, locale) : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{copy.project.daysToSpare}</dt>
        <dd className={cn("mt-0.5 text-base font-semibold tabular-nums", plan.bufferDays < 0 && "text-destructive")}>
          {plan.bufferDays}
        </dd>
      </div>
    </dl>
  );
}

/** Las sesiones agrupadas por día, cada una con su subtarea. */
export function PlanByDay({
  sessions,
  titleOf,
  isDone,
  actions
}: {
  sessions: readonly PlanSession[];
  titleOf: (subtaskId: string) => string;
  isDone?: (subtaskId: string) => boolean;
  /** Botones al final de cada fila (completar, saltear). */
  actions?: (session: PlanSession) => ReactNode;
}) {
  const { language } = useAppLanguage();
  const locale = getDateLocale(language);
  const groups = groupByDay(sessions);

  return (
    <ol className="flex flex-col gap-4">
      {groups.map((group) => (
        <li key={group.date}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold capitalize">{dayLabel(group.date, locale)}</h4>
            <span className="text-xs tabular-nums text-muted-foreground">{group.minutes} min</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {group.items.map((session) => {
              const done = isDone?.(session.subtaskId) ?? false;
              return (
                <li key={`${session.subtaskId}-${session.date}`} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className={cn("min-w-0 flex-1", done && "text-muted-foreground line-through")}>
                    {titleOf(session.subtaskId)}
                    {session.totalParts > 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {copy_part(session.part, session.totalParts)}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">{session.minutes} min</span>
                  {actions?.(session)}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** "1/3": lo mismo en todos los idiomas. */
const copy_part = (part: number, total: number) => `${part}/${total}`;
