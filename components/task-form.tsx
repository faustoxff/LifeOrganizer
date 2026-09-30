"use client";

import { FormEvent, useMemo, useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { weekdayOf } from "@/lib/recurrence";
import { weekdayShortName } from "@/lib/repeat-label";
import { getTodayDateValue } from "@/lib/task-date";
import {
  DEFAULT_ESTIMATE_BY_KIND,
  DEFAULT_ESTIMATE_MIN,
  ESTIMATE_OPTIONS_MIN,
  formatMinutes
} from "@/lib/task-estimate";
import { suggestKind } from "@/lib/task-kind";
import { cn } from "@/lib/utils";
import type { RepeatSpec, TaskInput, TaskKind, TaskPriority } from "@/types/task";

/** Lo que el formulario sabe editar: una tarea, sin la regla de repetición. */
export type TaskFormValues = Omit<TaskInput, "repeat">;

type TaskFormProps = {
  initialValues?: TaskFormValues;
  isSubmitting?: boolean;
  mode?: "create" | "edit";
  onCancel?: () => void;
  onSubmitTask: (task: TaskInput) => Promise<boolean>;
};

type RepeatMode = "none" | "daily" | "weekdays" | "everyNWeeks" | "monthly";

const KINDS: TaskKind[] = ["reminder", "task", "project"];
const REPEAT_MODES: RepeatMode[] = ["none", "daily", "weekdays", "everyNWeeks", "monthly"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const blankValues: TaskFormValues = {
  title: "",
  category: "",
  description: "",
  priority: "medium",
  estimateMin: DEFAULT_ESTIMATE_MIN,
  dueDate: "",
  kind: "task"
};

/** Las opciones del formulario, más el valor actual si es uno fuera de la lista. */
function estimateChoices(current: number): number[] {
  const options: number[] = [...ESTIMATE_OPTIONS_MIN];
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function buildRepeat(
  mode: RepeatMode,
  weekdays: number[],
  weeks: number,
  dueDate: string
): RepeatSpec | undefined {
  if (mode === "none") return undefined;
  if (mode === "daily") return { freq: "daily", interval: 1 };
  if (mode === "monthly") {
    return { freq: "monthly", interval: 1, monthDay: Number(dueDate.slice(8, 10)) };
  }
  // Sin ningún día marcado, la serie repite el día de la semana en que empieza.
  const days = weekdays.length > 0 ? [...weekdays].sort((a, b) => a - b) : [weekdayOf(dueDate)];
  return { freq: "weekly", interval: mode === "everyNWeeks" ? weeks : 1, weekdays: days };
}

export function TaskForm({
  initialValues,
  isSubmitting = false,
  mode = "create",
  onCancel,
  onSubmitTask
}: TaskFormProps) {
  const { copy, language } = useAppLanguage();
  const todayDateValue = getTodayDateValue();
  // El formulario se monta de nuevo por cada tarea (el padre le pasa `key`), así
  // que el estado se siembra una sola vez en vez de sincronizarse con un effect.
  const start = useMemo(
    () => ({ ...blankValues, ...initialValues, dueDate: initialValues?.dueDate ?? todayDateValue }),
    [initialValues, todayDateValue]
  );

  const [title, setTitle] = useState(start.title);
  const [category, setCategory] = useState(start.category);
  const [description, setDescription] = useState(start.description);
  const [priority, setPriority] = useState<TaskPriority>(start.priority);
  const [estimateMin, setEstimateMin] = useState(start.estimateMin);
  const [dueDate, setDueDate] = useState(start.dueDate);
  const [time, setTime] = useState(start.time ?? "");
  // Mientras el usuario no elija un tipo, los chips siguen a la sugerencia. Al
  // editar arrancan en el tipo que la tarea ya tiene: no se le cambia por debajo.
  const [pickedKind, setPickedKind] = useState<TaskKind | null>(mode === "edit" ? start.kind : null);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([]);
  const [repeatWeeks, setRepeatWeeks] = useState(2);
  const [showTimeError, setShowTimeError] = useState(false);

  const suggestedKind = suggestKind({ title, description, dueDate, time: time || undefined });
  const kind = pickedKind ?? suggestedKind;
  const isReminder = kind === "reminder";
  // Los proyectos no se repiten, y la regla de una serie no se cambia desde una
  // ocurrencia: solo se ofrece al crear una tarea o un recordatorio.
  const canRepeat = mode === "create" && kind !== "project";
  const usesWeekdays = repeatMode === "weekdays" || repeatMode === "everyNWeeks";
  const dueWeekday = dueDate ? weekdayOf(dueDate) : new Date().getDay();
  const shownWeekdays = repeatWeekdays.length > 0 ? repeatWeekdays : [dueWeekday];

  function toggleWeekday(day: number) {
    setRepeatWeekdays((current) => {
      const base = current.length > 0 ? current : [dueWeekday];
      return base.includes(day) ? base.filter((d) => d !== day) : [...base, day];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    if (isReminder && !time) {
      setShowTimeError(true);
      return;
    }

    const resolvedDueDate = dueDate || todayDateValue;
    const repeat = canRepeat ? buildRepeat(repeatMode, repeatWeekdays, repeatWeeks, resolvedDueDate) : undefined;

    const didSave = await onSubmitTask({
      title: trimmedTitle,
      category: category.trim() || "general",
      description: description.trim(),
      priority,
      estimateMin: isReminder ? DEFAULT_ESTIMATE_BY_KIND.reminder : estimateMin,
      dueDate: resolvedDueDate,
      kind,
      ...(time ? { time } : {}),
      ...(repeat ? { repeat } : {})
    });

    if (didSave && mode === "create") {
      setTitle("");
      setCategory("");
      setDescription("");
      setPriority("medium");
      setEstimateMin(DEFAULT_ESTIMATE_MIN);
      setDueDate(todayDateValue);
      setTime("");
      setPickedKind(null);
      setRepeatMode("none");
      setRepeatWeekdays([]);
      setRepeatWeeks(2);
      setShowTimeError(false);
    }
  }

  return (
    <section className="max-h-[calc(100dvh-2rem)] self-start overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-lg">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {mode === "edit" ? copy.taskForm.editTask : copy.taskForm.newTask}
      </p>
      <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label id="task-kind-label">{copy.taskForm.kind}</Label>
          <div role="radiogroup" aria-labelledby="task-kind-label" className="grid grid-cols-3 gap-2">
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                disabled={isSubmitting}
                onClick={() => setPickedKind(option)}
                className={cn(
                  "rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                  kind === option
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {copy.taskForm.kinds[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="task-title">{copy.taskForm.title}</Label>
          <Input
            id="task-title"
            disabled={isSubmitting}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={copy.taskForm.titlePlaceholder}
            type="text"
            value={title}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="task-category">{copy.taskForm.category}</Label>
          <Input
            id="task-category"
            disabled={isSubmitting}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={copy.taskForm.categoryPlaceholder}
            type="text"
            value={category}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="task-description">{copy.taskForm.description}</Label>
          <Textarea
            id="task-description"
            className="min-h-28"
            disabled={isSubmitting}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={copy.taskForm.descriptionPlaceholder}
            value={description}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-2">
            <Label className="flex min-h-10 items-end" htmlFor="task-priority">
              {copy.taskForm.priority}
            </Label>
            <Select
              id="task-priority"
              disabled={isSubmitting}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              value={priority}
            >
              <option value="low">{copy.taskForm.priorities.low}</option>
              <option value="medium">{copy.taskForm.priorities.medium}</option>
              <option value="high">{copy.taskForm.priorities.high}</option>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Label className="flex min-h-10 items-end" htmlFor="task-due-date">
              {copy.taskForm.dueDate}
            </Label>
            <Input
              id="task-due-date"
              className="h-10"
              disabled={isSubmitting}
              min={mode === "create" ? todayDateValue : undefined}
              onChange={(e) => setDueDate(e.target.value)}
              type="date"
              value={dueDate}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Label className="flex min-h-10 items-end" htmlFor="task-time">
              {isReminder ? copy.taskForm.time : copy.taskForm.timeOptional}
            </Label>
            <Input
              id="task-time"
              className="h-10"
              aria-invalid={showTimeError && isReminder && !time}
              disabled={isSubmitting}
              onChange={(e) => {
                setTime(e.target.value);
                setShowTimeError(false);
              }}
              aria-required={isReminder}
              type="time"
              value={time}
            />
          </div>
        </div>
        {showTimeError && isReminder && !time && (
          <p role="alert" className="-mt-2 text-xs text-destructive">
            {copy.taskForm.timeRequired}
          </p>
        )}

        {(!isReminder || canRepeat) && (
          <div className={cn("grid gap-4", !isReminder && canRepeat && "sm:grid-cols-2")}>
            {!isReminder && (
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="task-estimate">{copy.taskForm.duration}</Label>
                <Select
                  id="task-estimate"
                  disabled={isSubmitting}
                  onChange={(e) => setEstimateMin(Number(e.target.value))}
                  value={estimateMin}
                >
                  {estimateChoices(estimateMin).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatMinutes(minutes)}
                      {minutes === 120 ? "+" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {canRepeat && (
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="task-repeat">{copy.taskForm.repeat}</Label>
                <Select
                  id="task-repeat"
                  disabled={isSubmitting}
                  onChange={(e) => setRepeatMode(e.target.value as RepeatMode)}
                  value={repeatMode}
                >
                  {REPEAT_MODES.map((option) => (
                    <option key={option} value={option}>
                      {copy.taskForm.repeatOptions[option]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}

        {canRepeat && repeatMode === "everyNWeeks" && (
          <div className="flex items-center gap-2 text-sm">
            <span>{copy.taskForm.repeatEvery}</span>
            <Input
              aria-label={copy.taskForm.repeatWeeks}
              className="h-10 w-20"
              disabled={isSubmitting}
              inputMode="numeric"
              max={52}
              min={2}
              onChange={(e) => setRepeatWeeks(Math.min(52, Math.max(2, Math.floor(Number(e.target.value)) || 2)))}
              type="number"
              value={repeatWeeks}
            />
            <span>{copy.taskForm.repeatWeeks}</span>
          </div>
        )}

        {canRepeat && usesWeekdays && (
          <div className="flex flex-col gap-2">
            <Label id="task-repeat-days-label">{copy.taskForm.repeatOnDays}</Label>
            <div role="group" aria-labelledby="task-repeat-days-label" className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={shownWeekdays.includes(day)}
                  disabled={isSubmitting}
                  onClick={() => toggleWeekday(day)}
                  className={cn(
                    "rounded-lg border px-1 py-2 text-xs font-semibold capitalize transition-colors disabled:opacity-50",
                    shownWeekdays.includes(day)
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {weekdayShortName(day, language)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-3">
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting
              ? mode === "edit"
                ? copy.common.saving
                : copy.common.adding
              : mode === "edit"
                ? copy.taskForm.editSubmit
                : copy.taskForm.addTask}
          </Button>
          {mode === "edit" && onCancel ? (
            <Button
              disabled={isSubmitting}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              {copy.common.cancel}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
