"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Circle, Pause, Play, Sparkles, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { companionCopy, focusCopy, reminderCopy } from "@/lib/focus-copy";
import { MiloAvatar } from "@/components/milo-avatar";
import { type MiloFace } from "@/lib/milo-face";
import { showNotification } from "@/lib/use-reminders";
import { cn } from "@/lib/utils";
import type { Task, TaskStep } from "@/types/task";

const DURATIONS = [10, 25, 45];

type CompanionMoment = "start" | "middle" | "end" | "stuck";

type FocusModeProps = {
  task: Task;
  isPro?: boolean;
  isBreaking: boolean;
  onClose: () => void;
  onBreakDown: () => void;
  onToggleStep: (stepId: string) => void;
  /**
   * `elapsedMinutes` is the time the timer actually ran (rounded), or undefined if it
   * never did. A project session uses it as the real time spent.
   */
  onCompleteTask: (elapsedMinutes?: number) => void;
  /** Show a "done" button even without steps (a project session has none). */
  alwaysAllowComplete?: boolean;
  /** Hide "break it into steps": a project session is already one step of a plan. */
  hideBreakDown?: boolean;
};

// One task, one step, one timer: everything else is hidden on purpose.
export function FocusMode({ task, isPro = false, isBreaking, onClose, onBreakDown, onToggleStep, onCompleteTask, alwaysAllowComplete = false, hideBreakDown = false }: FocusModeProps) {
  const { language } = useAppLanguage();
  const t = focusCopy[language];
  const c = companionCopy[language];
  const [companionMessage, setCompanionMessage] = useState<string | null>(null);
  const [companionFace, setCompanionFace] = useState<MiloFace>("enfocado");
  const [companionBusy, setCompanionBusy] = useState(false);
  const halfwaySentRef = useRef(false);
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const taskRef = useRef(task);
  taskRef.current = task;
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;
  // Seconds the timer has really been running, across pauses and restarts.
  const elapsedRef = useRef(0);
  const completeWithElapsed = () => {
    const minutesRun = Math.round(elapsedRef.current / 60);
    onCompleteTask(minutesRun > 0 ? minutesRun : undefined);
  };

  // Body doubling: Milo says something at the start, at the halfway point,
  // when the timer ends, and whenever the user says they are stuck.
  const askCompanion = useCallback(
    async (moment: CompanionMoment) => {
      if (!isPro) return;
      setCompanionBusy(true);
      try {
        const steps = taskRef.current.steps ?? [];
        const res = await fetch("/api/milo/companion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            moment,
            taskTitle: taskRef.current.title,
            currentStep: steps.find((s) => !s.done)?.text ?? "",
            stepsDone: steps.filter((s) => s.done).length,
            stepsTotal: steps.length,
            minutes: minutesRef.current,
            uiLanguage: language
          })
        });
        const data = (await res.json()) as { message?: string | null };
        if (data.message) {
          setCompanionMessage(data.message);
          setCompanionFace(moment === "stuck" ? "animando" : moment === "end" ? "celebrando" : "enfocado");
        }
      } catch {
        /* the companion is a bonus: never interrupt the session */
      } finally {
        setCompanionBusy(false);
      }
    },
    [isPro, language]
  );

  // Tick once per second while running.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      elapsedRef.current += 1;
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          setFinished(true);
          const rt = reminderCopy[language];
          showNotification(rt.focusDone, rt.focusDoneBody);
          void askCompanion("end");
          return 0;
        }
        if (!halfwaySentRef.current && r <= Math.floor((minutesRef.current * 60) / 2)) {
          halfwaySentRef.current = true;
          void askCompanion("middle");
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, language, askCompanion]);

  // Esc closes; lock page scroll behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  // Show the countdown in the tab title so it stays visible in the background.
  useEffect(() => {
    const original = document.title;
    if (running) document.title = `${formatClock(remaining)} · ${task.title}`;
    return () => { document.title = original; };
  }, [running, remaining, task.title]);

  function pickDuration(m: number) {
    setMinutes(m);
    setRemaining(m * 60);
    setRunning(false);
    setFinished(false);
    halfwaySentRef.current = false;
  }

  const steps: TaskStep[] = task.steps ?? [];
  const currentStep = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const progress = 1 - remaining / (minutes * 60);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background/95 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={t.focus}>
      <div className="flex items-center justify-between px-5 py-4">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {t.focus}
        </span>
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" /> {t.exit}
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 pb-10 text-center">
        <p className="text-sm text-muted-foreground">{t.justThis}</p>
        <h2 className="mt-2 text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{task.title}</h2>

        {steps.length > 0 ? (
          <motion.div
            key={currentStep?.id ?? "all-done"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-6 w-full rounded-2xl border border-primary/30 bg-primary/5 p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-primary/90">{doneCount}/{steps.length}</p>
            <p className="mt-2 text-lg font-medium leading-snug">{currentStep ? currentStep.text : t.taskDone}</p>
            <Button
              className="mt-4 gap-1.5"
              onClick={() => (currentStep ? onToggleStep(currentStep.id) : completeWithElapsed())}
            >
              <CheckCircle2 className="h-4 w-4" />
              {currentStep ? t.stepDone : t.taskDone}
            </Button>
          </motion.div>
        ) : (
          <div className="mt-6 w-full rounded-2xl border border-border bg-card p-5">
            {!hideBreakDown && (
              <>
                <p className="text-sm text-muted-foreground">{t.hint}</p>
                <Button className="mt-3 gap-1.5" variant="outline" disabled={isBreaking} onClick={onBreakDown}>
                  <Sparkles className="h-4 w-4" />
                  {isBreaking ? t.breaking : t.breakDown}
                </Button>
              </>
            )}
            {alwaysAllowComplete && (
              <Button className={cn("gap-1.5", !hideBreakDown && "ml-2 mt-3")} onClick={completeWithElapsed}>
                <CheckCircle2 className="h-4 w-4" />
                {t.taskDone}
              </Button>
            )}
          </div>
        )}

        {/* Milo sitting with you (Pro) */}
        {isPro && (
          <div className="mt-4 w-full">
            <AnimatePresence mode="wait">
              {companionMessage && (
                <motion.div
                  key={companionMessage}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-start gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 text-left"
                >
                  <MiloAvatar face={companionFace} size={32} />
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">{c.withYou}</p>
                    <p className="mt-0.5 text-sm leading-relaxed">{companionMessage}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!finished && (
              <div className="mt-2 flex justify-center gap-2">
                <Button size="sm" variant="ghost" disabled={companionBusy} onClick={() => void askCompanion("stuck")}>
                  {c.stuck}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Timer */}
        <div className="mt-8 flex flex-col items-center">
          <div className="relative flex h-44 w-44 items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
              <circle cx="50" cy="50" r="46" fill="none" strokeWidth="4" className="stroke-secondary" />
              <circle
                cx="50" cy="50" r="46" fill="none" strokeWidth="4" strokeLinecap="round"
                className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
                strokeDasharray={2 * Math.PI * 46}
                strokeDashoffset={2 * Math.PI * 46 * (1 - progress)}
              />
            </svg>
            <span className="font-display text-4xl font-semibold tabular-nums">{formatClock(remaining)}</span>
          </div>

          {finished && <p className="mt-3 text-sm font-medium text-primary">{t.timeUp}</p>}

          <div className="mt-4 flex items-center gap-2">
            {DURATIONS.map((m) => (
              <button
                key={m}
                onClick={() => pickDuration(m)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  minutes === m ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {m} {t.minutes}
              </button>
            ))}
          </div>

          <Button
            className="mt-4 gap-1.5"
            onClick={() => {
              if (remaining === 0) pickDuration(minutes);
              setFinished(false);
              setRunning((r) => {
                const next = !r;
                if (next && remaining === minutes * 60) void askCompanion("start");
                return next;
              });
            }}
          >
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? t.pause : remaining < minutes * 60 && remaining > 0 ? t.resume : t.start}
          </Button>
        </div>

        {steps.length > 1 && (
          <ul className="mt-8 w-full space-y-1.5 text-left">
            {steps.map((s) => (
              <li key={s.id}>
                <button onClick={() => onToggleStep(s.id)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary/50">
                  {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" /> : <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />}
                  <span className={cn(s.done && "text-muted-foreground line-through")}>{s.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
