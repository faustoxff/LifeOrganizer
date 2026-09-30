"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { replanCopy } from "@/lib/replan-copy";
import type { ReplanApi } from "@/lib/use-replan";
import { isOverdueFixed } from "@/lib/task-replan";
import type { Task } from "@/types/task";

type Props = {
  api: ReplanApi;
  tasks: readonly Task[];
  /** "Hoy" del usuario, "YYYY-MM-DD". */
  today: string;
  onSplit: (taskId: string) => void;
  onLowerPriority: (taskId: string) => void;
  onDelete: (taskId: string) => void;
};

/** Tres o más veces movida: se sugiere hacer algo con ella en vez de seguir empujándola. */
const CHRONIC = 3;

/**
 * El aviso del replan, sin culpa: lo que se reacomodó (con el detalle a un toque y "Deshacer" por ítem), lo que
 * conviene decidir de una tarea que ya se movió varias veces, y lo que quedó de días anteriores (recordatorios y
 * tareas con hora, que nunca se mueven solos). Nada está en rojo: el rojo es solo para un conflicto real.
 */
export function ReplanNotice({ api, tasks, today, onSplit, onLowerPriority, onDelete }: Props) {
  const { language } = useAppLanguage();
  const t = replanCopy(language);
  const [open, setOpen] = useState(false);

  const formatDay = (day: string) =>
    new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`));

  const movedIds = new Set(api.moves.map((m) => m.taskId));
  const chronic = tasks.filter((task) => movedIds.has(task.id) && (task.postponedCount ?? 0) >= CHRONIC && !task.done);
  const left = tasks.filter((task) => isOverdueFixed(task, today));

  if (api.moves.length === 0 && left.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label={t.moved(api.moves.length)} data-testid="replan-notice">
      {api.moves.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm font-medium" data-testid="replan-summary">
              {t.moved(api.moves.length)}
            </p>
            <button
              type="button"
              onClick={() => void api.dismiss()}
              className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t.dismiss}
              title={t.dismiss}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? t.hideDetail : t.showDetail}
          </button>

          {open && (
            <ul className="mt-2 flex flex-col gap-1.5" data-testid="replan-details">
              {api.moves.map((move) => (
                <li key={move.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.moveRow(move.title, formatDay(move.from), formatDay(move.to))}</span>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" disabled={api.busy} onClick={() => void api.undo(move.id)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t.undo}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {chronic.map((task) => (
            <div key={task.id} className="mt-3 rounded-xl bg-secondary/40 p-2.5" data-testid="replan-suggestion">
              <p className="text-sm">{t.suggestion(task.title, task.postponedCount ?? CHRONIC)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onSplit(task.id)}>
                  {t.split}
                </Button>
                {task.priority !== "low" && (
                  <Button size="sm" variant="outline" onClick={() => onLowerPriority(task.id)}>
                    {t.lowerPriority}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => onDelete(task.id)}>
                  {t.remove}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {left.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3" data-testid="replan-left">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t.left.title}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {left.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{t.left.row(task.title)}</span>
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={api.busy} onClick={() => void api.resolveFixed(task.id, "done")}>
                  {t.left.done}
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={api.busy} onClick={() => void api.resolveFixed(task.id, "tomorrow")}>
                  {t.left.tomorrow}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={api.busy} onClick={() => void api.resolveFixed(task.id, "dismiss")}>
                  {t.left.discard}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
