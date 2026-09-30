"use client";

import { useState } from "react";
import { CheckCircle2, ChevronRight, Play, SkipForward, Sparkles } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectSession, ProjectSubtask, ProjectView } from "@/types/project";

/** Una sesión de hoy con lo que hace falta para mostrarla. */
export type TodaySession = {
  session: ProjectSession;
  subtask: ProjectSubtask;
  project: ProjectView;
};

/** Las sesiones de proyectos del día, en el orden del plan. */
export function getTodaySessions(projects: readonly ProjectView[], today: string): TodaySession[] {
  const out: TodaySession[] = [];
  for (const project of projects) {
    for (const session of project.sessions) {
      if (session.date !== today) continue;
      const subtask = project.subtasks.find((s) => s.id === session.subtaskId && !s.done);
      if (subtask) out.push({ session, subtask, project });
    }
  }
  return out;
}

const ACTUAL_CHOICES = [15, 30, 45, 60, 90];

type Chooser = { subtaskId: string; mode: "complete" | "progress" };

type Props = {
  sessions: TodaySession[];
  /** La sesión que la IA de prioridades recomienda ahora, si es una de estas. */
  recommendedSubtaskId?: string | null;
  disabled?: boolean;
  onComplete: (subtaskId: string, actualMin: number | null) => void;
  onProgress: (subtaskId: string, minutes: number) => void;
  onSkip: (subtaskId: string) => void;
  onFocus: (item: TodaySession) => void;
  onOpenProject: (projectId: string) => void;
};

/**
 * "Hoy" para los proyectos: cada sesión con el nombre del proyecto y su progreso X/Y.
 * Completar pregunta "¿cuánto tardaste?" con opciones (o se saltea); si se usó el
 * temporizador del modo foco, ese tiempo se usa directamente.
 */
export function TodayProjectSessions({
  sessions,
  recommendedSubtaskId,
  disabled = false,
  onComplete,
  onProgress,
  onSkip,
  onFocus,
  onOpenProject
}: Props) {
  const { copy } = useAppLanguage();
  const [chooser, setChooser] = useState<Chooser | null>(null);

  if (sessions.length === 0) return null;

  return (
    <div className="px-5 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        {copy.project.sessionsToday}
      </p>
      <ul className="flex flex-col gap-2">
        {sessions.map((item) => {
          const { session, subtask, project } = item;
          const isOpen = chooser?.subtaskId === subtask.id;
          const canPartial = session.totalParts > 1 && session.part < session.totalParts;
          return (
            <li
              key={session.id}
              className={cn(
                "rounded-xl border p-3",
                recommendedSubtaskId === subtask.id ? "border-primary/40 bg-primary/5" : "border-border"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{subtask.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <button
                      onClick={() => onOpenProject(project.task.id)}
                      className="inline-flex items-center gap-0.5 font-medium text-primary/90 hover:underline"
                    >
                      {project.task.title}
                      <ChevronRight className="h-3 w-3" aria-hidden />
                    </button>
                    <span className="tabular-nums">{project.progress.done}/{project.progress.total}</span>
                    <span>·</span>
                    <span className="tabular-nums">{session.minutes} min</span>
                    {session.totalParts > 1 && <span className="tabular-nums">· {session.part}/{session.totalParts}</span>}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={disabled} onClick={() => onFocus(item)} aria-label={copy.project.startFocus} title={copy.project.startFocus}>
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={disabled} onClick={() => setChooser(isOpen && chooser?.mode === "complete" ? null : { subtaskId: subtask.id, mode: "complete" })} aria-label={copy.project.done} title={copy.project.done}>
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={disabled} onClick={() => { setChooser(null); onSkip(subtask.id); }} aria-label={copy.project.skipToday} title={copy.project.skipToday}>
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-xs font-medium">{copy.project.howLong}</p>
                  <div className="flex flex-wrap gap-2">
                    {ACTUAL_CHOICES.map((minutes) => (
                      <button
                        key={minutes}
                        disabled={disabled}
                        onClick={() => {
                          setChooser(null);
                          if (chooser?.mode === "progress") onProgress(subtask.id, minutes);
                          else onComplete(subtask.id, minutes);
                        }}
                        className="rounded-full border border-border px-3 py-1 text-xs tabular-nums text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                      >
                        {minutes} min
                      </button>
                    ))}
                    {chooser?.mode === "complete" && (
                      <button
                        disabled={disabled}
                        onClick={() => { setChooser(null); onComplete(subtask.id, null); }}
                        className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        {copy.project.notSure}
                      </button>
                    )}
                  </div>
                  {canPartial && chooser?.mode === "complete" && (
                    <button
                      onClick={() => setChooser({ subtaskId: subtask.id, mode: "progress" })}
                      className="w-fit text-xs font-semibold text-primary underline underline-offset-2"
                    >
                      {copy.project.partDone}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "¿Cuánto tardaste?" cuando se termina desde el modo foco sin haber usado el
 * temporizador: opciones rápidas, o "no sé" para saltear (queda sin dato y no se usa
 * para aprender el factor de inflación).
 */
export function HowLongDialog({ onPick, onCancel }: { onPick: (minutes: number | null) => void; onCancel: () => void }) {
  const { copy } = useAppLanguage();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="how-long-title" className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg">
        <h2 id="how-long-title" className="text-base font-semibold tracking-tight">{copy.project.howLong}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {ACTUAL_CHOICES.map((minutes) => (
            <button key={minutes} onClick={() => onPick(minutes)} className="rounded-full border border-border px-3 py-1.5 text-sm tabular-nums text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
              {minutes} min
            </button>
          ))}
          <button onClick={() => onPick(null)} className="rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {copy.project.notSure}
          </button>
        </div>
        <Button variant="ghost" className="mt-4" onClick={onCancel}>{copy.common.cancel}</Button>
      </div>
    </div>
  );
}
