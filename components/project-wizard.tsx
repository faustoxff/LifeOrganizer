"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { formatPlanDate, PlanByDay, PlanSummary } from "@/components/project-plan-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getDateLocale } from "@/lib/i18n";
import { MAX_SUBTASK_MIN, MIN_SUBTASK_MIN } from "@/lib/project-schema";
import type { ProjectStartInput } from "@/components/task-form";
import { getDeviceTimeZone } from "@/lib/task-date";
import type { Intake, PlannedSubtask, ProjectDraftPlan, ProjectView } from "@/types/project";

type Stage = "reading" | "intake" | "questions" | "planning" | "preview" | "creating";

type WizardError = { message: string; retry?: () => void; upsell?: boolean };

type Props = {
  start: ProjectStartInput;
  onClose: () => void;
  onCreated: (projects: ProjectView[]) => void;
};

const MIN_TITLE = 3;

/** Un paso de la vista previa que el usuario puede editar. */
const isValidStep = (s: PlannedSubtask) =>
  s.title.trim().length >= MIN_TITLE &&
  s.title.trim().length <= 120 &&
  Number.isInteger(s.estimateMin) &&
  s.estimateMin >= MIN_SUBTASK_MIN &&
  s.estimateMin <= MAX_SUBTASK_MIN;

/**
 * El asistente de un proyecto: leer archivos → entender y preguntar → dividir →
 * vista previa editable → confirmar. La IA propone qué hacer y cuánto lleva; las
 * fechas las pone el scheduler en el servidor.
 */
export function ProjectWizard({ start, onClose, onCreated }: Props) {
  const { copy, language } = useAppLanguage();
  const locale = getDateLocale(language);

  const [stage, setStage] = useState<Stage>("reading");
  const [error, setError] = useState<WizardError | null>(null);
  const [readingName, setReadingName] = useState("");
  const [failedFiles, setFailedFiles] = useState<string[]>([]);
  const [contextSummary, setContextSummary] = useState("");
  const [intake, setIntake] = useState<Intake | null>(null);
  const [understanding, setUnderstanding] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<ProjectDraftPlan | null>(null);
  const [steps, setSteps] = useState<PlannedSubtask[]>([]);
  const [dirty, setDirty] = useState(false);
  const [deadline, setDeadline] = useState(start.deadline);
  const [extraMin, setExtraMin] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const nextId = useRef(1);
  const started = useRef(false);

  /** POST JSON con la zona y el idioma; devuelve el resultado o el error ya traducido. */
  const post = useCallback(
    async <T,>(path: string, body: Record<string, unknown>): Promise<{ data: T } | { error: WizardError }> => {
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, tz: getDeviceTimeZone(), uiLanguage: language })
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
        if (res.ok) return { data };
        if (data.code === "PLAN_REQUIRED") return { error: { message: copy.project.planRequired, upsell: true } };
        if (res.status === 429) return { error: { message: copy.project.dailyLimit } };
        if (data.error === "PROJECT_LIMIT_REACHED") return { error: { message: copy.project.projectLimit } };
        return { error: { message: typeof data.error === "string" && data.error ? data.error : copy.errors.unexpected } };
      } catch {
        return { error: { message: copy.errors.unexpected } };
      }
    },
    [copy, language]
  );

  const basics = useMemo(
    () => ({ title: start.title, description: start.description, deadline, contextSummary }),
    [start.title, start.description, deadline, contextSummary]
  );

  const runIntake = useCallback(
    async (summary: string) => {
      setError(null);
      setStage("intake");
      const result = await post<Intake>("/api/projects/intake", {
        title: start.title, description: start.description, deadline: start.deadline, contextSummary: summary
      });
      if ("error" in result) {
        setError({ ...result.error, retry: () => void runIntake(summary) });
        return;
      }
      setIntake(result.data);
      setUnderstanding(result.data.understanding);
      setStage("questions");
    },
    [post, start.title, start.description, start.deadline]
  );

  // Arranca solo: primero los archivos (uno por request), después el intake.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const summaries: string[] = [];
      const failed: string[] = [];
      for (const file of start.files) {
        setReadingName(file.name);
        const form = new FormData();
        form.set("file", file);
        form.set("of", String(start.files.length));
        form.set("uiLanguage", language);
        try {
          const res = await fetch("/api/projects/extract", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { summary?: string; code?: string };
          if (res.ok && data.summary) summaries.push(data.summary);
          else if (data.code === "PLAN_REQUIRED") { setError({ message: copy.project.planRequired, upsell: true }); return; }
          else failed.push(file.name);
        } catch {
          failed.push(file.name);
        }
      }
      setFailedFiles(failed);
      const summary = summaries.join("\n\n");
      setContextSummary(summary);
      await runIntake(summary);
    })();
  }, [start.files, language, copy, runIntake]);

  async function makePlan() {
    if (!intake) return;
    setError(null);
    setStage("planning");
    const result = await post<ProjectDraftPlan>("/api/projects/plan", {
      title: start.title,
      description: start.description,
      deadline,
      contextSummary,
      understanding,
      answers: intake.questions.map((q) => ({ id: q.id, question: q.text, answer: answers[q.id] ?? "" }))
    });
    if ("error" in result) {
      setError({ ...result.error, retry: () => void makePlan() });
      setStage("questions");
      return;
    }
    setDraft(result.data);
    setSteps(result.data.subtasks);
    setDirty(false);
    setStage("preview");
  }

  async function recalculate(next?: { deadline?: string; extra?: number }) {
    const newDeadline = next?.deadline ?? deadline;
    const newExtra = next?.extra ?? extraMin;
    setIsRecalculating(true);
    setError(null);
    const result = await post<ProjectDraftPlan>("/api/projects/preview", {
      ...basics, deadline: newDeadline, subtasks: steps, extraMinPerDay: newExtra
    });
    setIsRecalculating(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDeadline(newDeadline);
    setExtraMin(newExtra);
    setDraft(result.data);
    setDirty(false);
  }

  async function confirm() {
    setError(null);
    setStage("creating");
    const result = await post<{ projects: ProjectView[] }>("/api/projects", {
      ...basics, subtasks: steps, extraMinPerDay: extraMin
    });
    if ("error" in result) {
      setError({ ...result.error, retry: () => void confirm() });
      setStage("preview");
      return;
    }
    onCreated(result.data.projects);
    onClose();
  }

  function editStep(tempId: string, patch: Partial<PlannedSubtask>) {
    setSteps((current) => current.map((s) => (s.tempId === tempId ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  function removeStep(tempId: string) {
    setSteps((current) =>
      current.filter((s) => s.tempId !== tempId).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== tempId) }))
    );
    setDirty(true);
  }

  function addStep() {
    setSteps((current) => [...current, { tempId: `u${nextId.current++}`, title: "", estimateMin: 30, dependsOn: [], deliverable: false }]);
    setDirty(true);
  }

  const plan = draft?.plan;
  const totalMin = draft?.sessions.reduce((sum, s) => sum + s.minutes, 0) ?? 0;
  const stepsValid = steps.length > 0 && steps.every(isValidStep);
  const busy = stage === "reading" || stage === "intake" || stage === "planning" || stage === "creating";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-wizard-title"
        className="relative my-4 w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-lg"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute right-3 top-3 h-8 w-8 rounded-full"
          aria-label={copy.common.close}
        >
          <X className="h-4 w-4" />
        </Button>

        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{copy.project.wizardTitle}</p>
        <h2 id="project-wizard-title" className="mt-1 pr-8 text-lg font-semibold tracking-tight">{start.title}</h2>

        {error && (
          <div role="alert" className="mt-4 flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p>{error.message}</p>
            <div className="flex flex-wrap gap-3">
              {error.retry && (
                <button onClick={error.retry} className="font-semibold underline underline-offset-2">{copy.project.retry}</button>
              )}
              {error.upsell && (
                <Link href="/plans" className="font-semibold underline underline-offset-2">{copy.project.upgrade}</Link>
              )}
            </div>
          </div>
        )}

        {(stage === "reading" || stage === "intake" || stage === "planning" || stage === "creating") && !error && (
          <div role="status" className="mt-8 flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            <p>
              {stage === "reading"
                ? copy.project.readingFile(readingName)
                : stage === "intake"
                  ? copy.project.thinking
                  : stage === "planning"
                    ? copy.project.planning
                    : copy.project.creating}
            </p>
          </div>
        )}

        {failedFiles.length > 0 && stage !== "reading" && (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
            {failedFiles.map((name) => (
              <li key={name}>{copy.project.fileFailed(name)}</li>
            ))}
          </ul>
        )}

        {stage === "questions" && intake && (
          <div className="mt-5 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-understanding" className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
                {copy.project.understanding}
              </Label>
              <Textarea
                id="project-understanding"
                value={understanding}
                onChange={(e) => setUnderstanding(e.target.value)}
                className="min-h-24"
                maxLength={1200}
              />
              <p className="text-xs text-muted-foreground">{copy.project.correct}</p>
            </div>

            {intake.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copy.project.noQuestions}</p>
            ) : (
              <fieldset className="flex flex-col gap-4">
                <legend className="text-sm font-semibold">{copy.project.questionsTitle}</legend>
                {intake.questions.map((q) => (
                  <div key={q.id} className="flex flex-col gap-1.5">
                    <Label htmlFor={`q-${q.id}`}>{q.text}</Label>
                    {q.why && <p className="text-xs text-muted-foreground">{q.why}</p>}
                    {q.type === "choice" && q.options ? (
                      <div role="radiogroup" aria-label={q.text} className="flex flex-wrap gap-2">
                        {q.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={answers[q.id] === option}
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: a[q.id] === option ? "" : option }))}
                            className={
                              answers[q.id] === option
                                ? "rounded-lg border border-primary bg-primary/15 px-3 py-1.5 text-sm text-primary"
                                : "rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Input
                        id={`q-${q.id}`}
                        type={q.type === "number" ? "number" : "text"}
                        value={answers[q.id] ?? ""}
                        placeholder={copy.project.answerPlaceholder}
                        maxLength={600}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </fieldset>
            )}

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void makePlan()} disabled={understanding.trim().length < 10}>
                {copy.project.makePlan}
              </Button>
              <Button variant="ghost" onClick={onClose}>{copy.common.cancel}</Button>
            </div>
          </div>
        )}

        {stage === "preview" && draft && plan && (
          <div className="mt-5 flex flex-col gap-5">
            <h3 className="text-sm font-semibold">{copy.project.previewTitle}</h3>
            <PlanSummary plan={plan} totalMin={totalMin} />

            {!plan.feasible && (
              <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <p className="font-semibold text-destructive">{copy.project.notFitTitle}</p>
                <p>{copy.project.shortfall(plan.shortfallMin)}</p>
                <div className="flex flex-col gap-2">
                  {plan.options?.extraMinPerDay != null && (
                    <Button size="sm" variant="outline" disabled={isRecalculating} onClick={() => void recalculate({ extra: extraMin + (plan.options?.extraMinPerDay ?? 0) })}>
                      {copy.project.optExtra(plan.options.extraMinPerDay)}
                    </Button>
                  )}
                  {plan.options?.achievableDeadline && (
                    <Button size="sm" variant="outline" disabled={isRecalculating} onClick={() => void recalculate({ deadline: plan.options?.achievableDeadline ?? deadline })}>
                      {copy.project.optDate(formatPlanDate(plan.options.achievableDeadline, locale))}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {copy.project.optTrim(Math.ceil(plan.shortfallMin / (draft.inflation || 1)))}
                  </p>
                </div>
              </div>
            )}

            {plan.feasible && plan.bufferConsumedPct > 50 && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                {copy.project.tightNote}
              </p>
            )}

            {(extraMin > 0 || deadline !== start.deadline) && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {extraMin > 0 && <p>{copy.project.extraApplied(extraMin)}</p>}
                {deadline !== start.deadline && <p>{copy.project.optDate(formatPlanDate(deadline, locale))}</p>}
                <button
                  className="w-fit font-semibold underline underline-offset-2"
                  disabled={isRecalculating}
                  onClick={() => void recalculate({ deadline: start.deadline, extra: 0 })}
                >
                  {copy.project.undo}
                </button>
              </div>
            )}

            <section aria-label={copy.project.stepsTitle} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{copy.project.stepsTitle}</h3>
              <ul className="flex flex-col gap-2">
                {steps.map((step) => (
                  <li key={step.tempId} className="flex items-center gap-2">
                    <Input
                      aria-label={copy.project.stepTitleLabel}
                      value={step.title}
                      maxLength={120}
                      aria-invalid={!isValidStep(step)}
                      onChange={(e) => editStep(step.tempId, { title: e.target.value })}
                      className="h-9 flex-1"
                    />
                    <Input
                      aria-label={`${copy.project.minutesLabel}: ${step.title}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_SUBTASK_MIN}
                      max={MAX_SUBTASK_MIN}
                      step={5}
                      value={step.estimateMin}
                      onChange={(e) => editStep(step.tempId, { estimateMin: Math.round(Number(e.target.value)) })}
                      className="h-9 w-20"
                    />
                    <button
                      type="button"
                      aria-label={`${copy.project.removeStep}: ${step.title}`}
                      onClick={() => removeStep(step.tempId)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={addStep} disabled={steps.length >= 25} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  {copy.project.addStep}
                </Button>
                {dirty && (
                  <Button type="button" size="sm" onClick={() => void recalculate()} disabled={!stepsValid || isRecalculating}>
                    {isRecalculating ? copy.project.recalculating : copy.project.recalculate}
                  </Button>
                )}
              </div>
            </section>

            {!dirty && draft.sessions.length > 0 && (
              <PlanByDay
                sessions={draft.sessions}
                titleOf={(id) => steps.find((s) => s.tempId === id)?.title ?? ""}
              />
            )}

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void confirm()} disabled={dirty || !stepsValid || isRecalculating || busy}>
                {copy.project.confirm}
              </Button>
              <Button variant="ghost" onClick={onClose}>{copy.common.cancel}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
