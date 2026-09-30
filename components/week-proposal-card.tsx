"use client";

import { AlertTriangle, CheckCircle, Repeat, XCircle } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import {
  dayLabel,
  describeDeferred,
  describeReason,
  describeWarning,
  formatMinutes
} from "@/lib/week-plan-text";
import { cn } from "@/lib/utils";
import type { WeekProposal } from "@/types/milo";

type Props = {
  proposal: WeekProposal;
  /** Cuántos ítems se crean al confirmar. */
  count: number;
  disabled?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

/**
 * La propuesta de `plan_week` en el chat: la semana por día, con la razón de cada
 * decisión y, aparte, lo que no entró. Nada existe hasta que el usuario confirma.
 */
export function WeekProposalCard({ proposal, count, disabled = false, onConfirm, onDismiss }: Props) {
  const { copy, language } = useAppLanguage();
  const t = copy.weekPlan;
  // Un día vacío solo se muestra si es el liviano: es la parte de la propuesta que se quiere ver.
  const days = proposal.days.filter((day) => day.items.length > 0 || day.light);

  return (
    <div className="mt-2 w-full max-w-[85%] space-y-2 rounded-xl border border-border bg-card p-3" data-testid="week-proposal">
      <p className="text-xs font-semibold text-foreground">{t.title}</p>

      <div className="max-h-72 space-y-2 overflow-y-auto">
        {days.map((day) => (
          <div key={day.date} className="rounded-lg bg-background/60 px-2.5 py-1.5" data-testid="proposal-day">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="text-xs font-semibold capitalize text-foreground">{dayLabel(day.date, language)}</p>
              <p className="text-[11px] text-muted-foreground">
                {day.capacityMin === 0 ? t.offDay : t.loadOf(formatMinutes(day.existingMin + day.plannedMin), formatMinutes(day.capacityMin))}
                {day.light && day.capacityMin > 0 && <span className="ml-1.5 font-medium text-primary/90">· {t.lightDay}</span>}
              </p>
            </div>
            {day.items.map((item, idx) => (
              <div key={`${item.title}-${idx}`} className="mt-1">
                <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {item.title}
                  {item.dates && <Repeat className="h-3 w-3 text-primary/90" aria-hidden />}
                  <span className="text-xs font-normal text-muted-foreground">· {formatMinutes(item.estimateMin)}</span>
                </p>
                <p className="text-xs leading-snug text-muted-foreground">{describeReason(item.reason, language)}</p>
              </div>
            ))}
          </div>
        ))}

        {proposal.outside.length > 0 && (
          <div className="rounded-lg bg-background/60 px-2.5 py-1.5">
            <p className="text-xs font-semibold text-foreground">{t.outsideTitle}</p>
            {proposal.outside.map((item, idx) => (
              <p key={`${item.title}-${idx}`} className="mt-0.5 text-xs text-muted-foreground">
                {item.title} · {dayLabel(item.date, language)}
              </p>
            ))}
          </div>
        )}

        {proposal.deferred.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5" data-testid="proposal-deferred">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{t.deferredTitle}</p>
            {proposal.deferred.map((item, idx) => (
              <div key={`${item.title}-${idx}`} className="mt-1">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-xs leading-snug text-muted-foreground">{describeDeferred(item, language)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {proposal.warnings.map((warning, idx) => (
        <p key={idx} className={cn("flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400")}>
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
          {describeWarning(warning, language)}
        </p>
      ))}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onConfirm}
          disabled={disabled || count === 0}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <CheckCircle className="h-3 w-3" />
          {t.createAll(count)}
        </button>
        <button
          onClick={onDismiss}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <XCircle className="h-3 w-3" />
          {copy.milo.dismiss}
        </button>
      </div>
    </div>
  );
}
