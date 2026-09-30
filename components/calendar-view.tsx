"use client";

import { canFocusTask } from "@/lib/focus-eligibility";
import Image from "next/image";
import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Plus, CheckCircle2, Circle, Pencil, Play, Repeat, SlidersHorizontal, Trash2 } from "lucide-react";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDueDate, getDueDateLabel } from "@/lib/task-date";
import { getTaskDurationLabel } from "@/lib/task-labels";
import { getTodayReminders, isFutureOccurrence, isRecommendable, isVisibleInToday } from "@/lib/task-views";
import { emptyStateCopy, focusCopy, monthCopy, quickAddCopy } from "@/lib/focus-copy";
import { miloFace } from "@/lib/milo-face";
import { Input } from "@/components/ui/input";
import { NowCard } from "@/components/now-card";
import { PriorityPill } from "@/components/priority-pill";
import type { NowView } from "@/lib/use-now";
import { Task } from "@/types/task";

// Weekday / month names come from Intl so they follow the app language.
function getWeekdayLabels(language: string) {
  const fmt = new Intl.DateTimeFormat(language, { weekday: "short" });
  // 2023-01-01 was a Sunday; the grid starts on Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)).replace(/\.$/, ""));
}

function getMonthLabel(language: string, year: number, month: number) {
  const label = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();

  const days: { key: string; date: Date; currentMonth: boolean }[] = [];

  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ key: toDateKey(d), date: d, currentMonth: false });
  }
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const d = new Date(year, month, i);
    days.push({ key: toDateKey(d), date: d, currentMonth: true });
  }
  const rem = 7 - (days.length % 7);
  if (rem < 7) {
    for (let i = 1; i <= rem; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ key: toDateKey(d), date: d, currentMonth: false });
    }
  }
  return days;
}

type CalendarViewProps = {
  allTasks: Task[];
  isMutating: boolean;
  /** Qué hacer ahora (Plus/Pro). null = sin tarjeta. */
  now: NowView | null;
  onStartSession: (subtaskId: string) => void;
  onAddTask: () => void;
  onDeleteTask: (id: string) => Promise<void>;
  onEditTask: (id: string) => void;
  onToggleTask: (id: string) => Promise<void>;
  onFocusTask: (id: string) => void;
  onBreakDown: (id: string) => void;
  breakingDownTaskId: string | null;
  onQuickAdd: (title: string) => Promise<void>;
  /** Progreso X/Y por id de proyecto: las filas de proyecto lo muestran. */
  projectProgress?: Record<string, { done: number; total: number }>;
  onOpenProject?: (projectId: string) => void;
  /** Lo que se muestra debajo de cada tarea (por ejemplo, su checklist de "no te olvides"). */
  renderTaskExtra?: (task: Task) => ReactNode;
  /** Lo que va entre la recomendación y los recordatorios: las sesiones de proyectos de hoy. */
  projectSlot?: ReactNode;
  /** Sesiones de proyecto de hoy: se suman al conteo de pendientes del encabezado. */
  extraPending?: number;
};

export function CalendarView({
  allTasks,
  isMutating,
  now,
  onStartSession,
  onAddTask,
  onDeleteTask,
  onEditTask,
  onToggleTask,
  onFocusTask,
  onBreakDown,
  breakingDownTaskId,
  onQuickAdd,
  projectProgress,
  onOpenProject,
  renderTaskExtra,
  projectSlot,
  extraPending = 0
}: CalendarViewProps) {
  const { language, copy } = useAppLanguage();
  const quickT = quickAddCopy[language];
  const [quickTitle, setQuickTitle] = useState("");
  const emptyT = emptyStateCopy[language];
  const monthT = monthCopy[language];
  const today = new Date();
  const todayKey = toDateKey(today);

  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Collapsed = only the current week; expanded = the whole month.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showOlder, setShowOlder] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const calDays = getCalendarDays(year, month);
  const weekdays = getWeekdayLabels(language);
  // The week that contains today (or the first one) is always visible; the rest expand/collapse.
  const { weeksBefore, currentWeek, weeksAfter } = useMemo(() => {
    const weeks: (typeof calDays)[] = [];
    for (let i = 0; i < calDays.length; i += 7) weeks.push(calDays.slice(i, i + 7));
    const idx = weeks.findIndex((w) => w.some((d) => d.key === todayKey));
    const cur = idx === -1 ? 0 : idx;
    return {
      weeksBefore: weeks.slice(0, cur).flat(),
      currentWeek: weeks[cur] ?? [],
      weeksAfter: weeks.slice(cur + 1).flat()
    };
  }, [calDays, todayKey]);

  const tasksByDate = allTasks.reduce<Record<string, Task[]>>((acc, task) => {
    if (!task.dueDate) return acc;
    if (!acc[task.dueDate]) acc[task.dueDate] = [];
    acc[task.dueDate].push(task);
    return acc;
  }, {});

  // What "today" shows: pending, not skipped, and no future occurrences of a
  // series (those live in the calendar until their day comes).
  const pendingCount = useMemo(
    () => allTasks.filter((t) => isVisibleInToday(t, todayKey)).length,
    [allTasks, todayKey]
  );

  const todayReminders = useMemo(() => getTodayReminders(allTasks, todayKey), [allTasks, todayKey]);
  const todayReminderIds = useMemo(() => new Set(todayReminders.map((t) => t.id)), [todayReminders]);

  // The task the card recommends right now (reminders never compete, and a rest/prepare card has none).
  const recommendedId = now?.current.type === "task" ? now.current.task.id : null;
  const recommendedTask = recommendedId ? allTasks.find((t) => t.id === recommendedId && isRecommendable(t, todayKey)) ?? null : null;

  // Pending first (soonest due date first); completed ones after, most recent first.
  const byDueAsc = (a: Task, b: Task) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  const byDoneDesc = (a: Task, b: Task) =>
    (b.completedAt ?? b.dueDate).localeCompare(a.completedAt ?? a.dueDate);

  // First day of the current month, in local time.
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);
  const isThisMonth = (task: Task) => (task.completedAt ?? task.dueDate).slice(0, 10) >= monthStart;

  const dayTasksSelected = selectedKey ? (tasksByDate[selectedKey] ?? []) : null;
  // Without a selected day the list is "today": future occurrences of a series
  // stay out of it. Picking a day in the calendar shows everything on that day.
  const listSource = dayTasksSelected ?? allTasks.filter((t) => !isFutureOccurrence(t, todayKey));
  const pendingList = listSource.filter((t) => !t.done).sort(byDueAsc);
  const allDone = listSource.filter((t) => t.done).sort(byDoneDesc);
  const doneThisMonth = allDone.filter(isThisMonth);
  const doneOlder = allDone.filter((t) => !isThisMonth(t));
  const doneList = showOlder ? allDone : doneThisMonth;
  // The recommended task already has its own card above, so it is not repeated in the list.
  // Today's reminders have their own section, so they are not repeated here either.
  const listPending = selectedKey
    ? pendingList
    : pendingList.filter((t) => t.id !== recommendedTask?.id && !todayReminderIds.has(t.id));
  const displayedTasks = [...listPending, ...(selectedKey ? doneList : [])];

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1));
  }
  function nextMonth() {
    setViewDate(new Date(year, month + 1, 1));
  }

  function renderRow(task: Task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        language={language}
        isMutating={isMutating}
        isRecommended={task.id === recommendedTask?.id}
        onToggle={() => void onToggleTask(task.id)}
        onEdit={() => onEditTask(task.id)}
        onDelete={() => void onDeleteTask(task.id)}
        onFocus={() => onFocusTask(task.id)}
        extra={renderTaskExtra?.(task)}
        progress={task.kind === "project" ? projectProgress?.[task.id] : undefined}
        onOpenProject={task.kind === "project" && onOpenProject ? () => onOpenProject(task.id) : undefined}
      />
    );
  }

  function renderDay({ key, date, currentMonth }: { key: string; date: Date; currentMonth: boolean }) {
    const dayTasks = tasksByDate[key] ?? [];
    const isToday = key === todayKey;
    const isSelected = key === selectedKey;
    const hasHighPriority = dayTasks.some((t) => !t.done && t.priority === "high");
    const pendingCount = dayTasks.filter((t) => !t.done).length;
    const doneCount = dayTasks.filter((t) => t.done).length;

    return (
      <div key={key} className="px-0.5">
      <button
        onClick={() => setSelectedKey(isSelected ? null : key)}
        className={cn(
          "relative flex h-9 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-xs transition-colors",
          currentMonth ? "text-foreground" : "text-muted-foreground/30",
          !currentMonth && "pointer-events-none",
          isSelected && "bg-primary text-primary-foreground",
          !isSelected && isToday && "bg-primary/15 font-bold text-primary ring-1 ring-inset ring-primary/40",
          !isSelected && !isToday && currentMonth && "hover:bg-secondary/60"
        )}
      >
        <span className="leading-none">{date.getDate()}</span>
        {dayTasks.length > 0 && (
          <div className="flex gap-0.5">
            {pendingCount > 0 && (
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                isSelected
                  ? "bg-primary-foreground"
                  : hasHighPriority
                    ? "bg-red-400"
                    : "bg-primary"
              )} />
            )}
            {doneCount > 0 && (
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                isSelected ? "bg-primary-foreground/50" : "bg-muted-foreground/60"
              )} />
            )}
          </div>
        )}
      </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar: heading, quick capture and the full form button share one row on wide screens. */}
      <div className="flex flex-shrink-0 flex-col gap-3 border-b border-border px-5 py-3 lg:h-[68px] lg:flex-row lg:items-center lg:py-0">
        <div className="flex items-center justify-between gap-3 lg:justify-start">
          <div>
            <h2 className="text-lg font-semibold leading-7 tracking-tight">{copy.calendar.myTasks}</h2>
            <p className="text-xs leading-4 text-muted-foreground">
              {pendingCount + extraPending} {copy.taskList.pending.toLowerCase()}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onAddTask}
            aria-label={copy.calendar.newTask}
            title={copy.calendar.newTask}
            className="h-9 w-9 flex-shrink-0 text-muted-foreground lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick capture: title only, so a thought can be saved before it is lost. */}
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = quickTitle.trim();
            if (!value || isMutating) return;
            setQuickTitle("");
            void onQuickAdd(value);
          }}
        >
          <Input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder={quickT.placeholder}
            aria-label={quickT.add}
            className="h-10 flex-1 text-base sm:text-sm"
          />
          <Button type="submit" size="icon" className="h-10 w-10 flex-shrink-0" disabled={!quickTitle.trim() || isMutating} aria-label={quickT.add}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>

        <Button
          size="icon"
          variant="ghost"
          onClick={onAddTask}
          aria-label={copy.calendar.newTask}
          title={copy.calendar.newTask}
          className="hidden h-10 w-10 flex-shrink-0 text-muted-foreground lg:flex"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* What to do right now — the star of the screen */}
        {now && (
          <div className="px-5 pt-3">
            <NowCard
              view={now}
              allTasks={allTasks}
              isMutating={isMutating}
              breakingDownTaskId={breakingDownTaskId}
              onFocusTask={onFocusTask}
              onBreakDown={onBreakDown}
              onToggleTask={onToggleTask}
              onEditTask={onEditTask}
              onStartSession={onStartSession}
              renderTaskExtra={renderTaskExtra}
            />
          </div>
        )}

        {projectSlot}

        {/* Today's reminders: timed one-liners that never compete as the recommended task */}
        {todayReminders.length > 0 && (
          <div className="px-5 pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              {copy.calendar.todayReminders}
            </p>
            <ul className="flex flex-col gap-1.5">
              {todayReminders.map((task) => (
                <li
                  key={task.id}
                  className="group flex items-center gap-3 rounded-xl border border-border px-3 py-2 transition-colors hover:bg-secondary/30"
                >
                  <button
                    onClick={() => void onToggleTask(task.id)}
                    disabled={isMutating}
                    className="flex-shrink-0 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                    aria-label={copy.taskList.markDone}
                  >
                    <Circle className="h-4 w-4" />
                  </button>
                  {task.time && (
                    <span className="flex-shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {task.time}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                  {task.dueDate < todayKey && (
                    <span className="flex-shrink-0 text-[11px] text-red-400">{getDueDateLabel(task.dueDate, language)}</span>
                  )}
                  {task.seriesId && <Repeat className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label={copy.taskList.repeats} />}
                  <div className="flex flex-shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <button
                      onClick={() => onEditTask(task.id)}
                      disabled={isMutating}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      aria-label={copy.taskList.edit}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void onDeleteTask(task.id)}
                      disabled={isMutating}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      aria-label={copy.common.delete}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Calendar */}
        <div className="px-5 py-3">
          {/* Month navigation */}
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={prevMonth}
              disabled={!calendarOpen}
              aria-label="‹"
              className={cn("rounded-lg p-1.5 text-muted-foreground transition-all duration-300 hover:bg-secondary hover:text-foreground", !calendarOpen && "pointer-events-none opacity-0")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold">
              {getMonthLabel(language, year, month)}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCalendarOpen((v) => !v)}
                aria-expanded={calendarOpen}
                aria-label={getMonthLabel(language, year, month)}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", calendarOpen && "rotate-180")} />
              </button>
              <button
                onClick={nextMonth}
                disabled={!calendarOpen}
                aria-label="›"
                className={cn("rounded-lg p-1.5 text-muted-foreground transition-all duration-300 hover:bg-secondary hover:text-foreground", !calendarOpen && "pointer-events-none opacity-0")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Weekday headers: same grid geometry as the days below, so each
              label sits exactly over its column. */}
          <div className="grid grid-cols-7 gap-x-0.5">
            {weekdays.map((d, i) => (
              <div
                key={d}
                className={cn(
                  "px-0.5 pb-1.5 text-center text-[11px] font-semibold uppercase tracking-wider",
                  i === 0 || i === 6 ? "text-muted-foreground/60" : "text-muted-foreground"
                )}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Days grid: the current week is always visible; the other weeks expand smoothly */}
          <div>
            <CollapsibleWeeks open={calendarOpen} position="before">
              {weeksBefore.map(renderDay)}
            </CollapsibleWeeks>
            <div className="grid grid-cols-7 gap-x-0.5 gap-y-0.5">{currentWeek.map(renderDay)}</div>
            <CollapsibleWeeks open={calendarOpen} position="after">
              {weeksAfter.map(renderDay)}
            </CollapsibleWeeks>
          </div>
        </div>

        {/* Task list */}
        <div className="border-t border-border px-5 pb-6 pt-4">
          <div className={cn("mb-3 flex items-center justify-between", allTasks.length === 0 && "hidden")}>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {selectedKey
                ? `${copy.calendar.tasksFor} ${new Date(selectedKey + "T12:00:00").toLocaleDateString(language, { day: "numeric", month: "long" })}`
                : copy.calendar.allTasks}
            </p>
            {selectedKey && (
              <button
                onClick={() => setSelectedKey(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {copy.calendar.viewAll}
              </button>
            )}
          </div>

          {displayedTasks.length === 0 ? (
            // Nothing to list: either there are no tasks at all / on that day, or the only pending one is the recommended card above.
            selectedKey ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{copy.calendar.noTasksDay}</p>
            ) : allTasks.length === 0 ? (
              // First run: aim the user straight at the thing they are avoiding.
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <Image src={miloFace("saludando")} alt="" width={112} height={112} className="h-28 w-28 object-contain" />
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{emptyT.title}</h3>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">{emptyT.text}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {emptyT.examples.map((example) => (
                    <button
                      key={example}
                      onClick={() => void onQuickAdd(example)}
                      disabled={isMutating}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                    >
                      + {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          ) : (
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>{displayedTasks.map(renderRow)}</AnimatePresence>
            </ul>
          )}

          {!selectedKey && allDone.length > 0 && (
            <>
              <button
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                {/* Chevron trails the label so this heading starts on the same
                    left edge as the others instead of being pushed in by an icon. */}
                {monthT.thisMonth} ({doneThisMonth.length})
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", showDone && "rotate-180")} />
              </button>
              <Collapsible open={showDone}>
                <ul className="flex flex-col gap-2 pt-3">
                  <AnimatePresence initial={false}>{doneList.map(renderRow)}</AnimatePresence>
                </ul>
                {doneOlder.length > 0 && !showOlder && (
                  <button
                    onClick={() => setShowOlder(true)}
                    className="mt-3 text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                  >
                    {monthT.showOlder} ({doneOlder.length})
                  </button>
                )}
              </Collapsible>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type TaskRowProps = {
  task: Task;
  language: import("@/lib/i18n").AppLanguage;
  isMutating: boolean;
  isRecommended: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFocus: () => void;
  progress?: { done: number; total: number };
  onOpenProject?: () => void;
  extra?: ReactNode;
};

function TaskRow({ task, language, isMutating, isRecommended, onToggle, onEdit, onDelete, onFocus, progress, onOpenProject, extra }: TaskRowProps) {
  const { copy } = useAppLanguage();
  const focusT = focusCopy[language];
  const steps = task.steps ?? [];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        "group flex items-start gap-3 rounded-xl border p-3 transition-colors",
        isRecommended ? "border-primary/40 bg-primary/5" : "border-border hover:border-border/80 hover:bg-secondary/30"
      )}
    >
      <button
        onClick={onToggle}
        disabled={isMutating}
        className="mt-0.5 flex-shrink-0 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
        aria-label={task.done ? copy.taskList.markPending : copy.taskList.markDone}
      >
        {task.done
          ? <CheckCircle2 className="h-4 w-4 text-primary" />
          : <Circle className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium leading-snug", task.done && "line-through text-muted-foreground")}>
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{task.category}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {getDueDateLabel(task.dueDate, language)} · {formatDueDate(task.dueDate, language)}
          </span>
          {task.time && (
            <span className="text-xs font-medium tabular-nums text-muted-foreground">{task.time}</span>
          )}
          {task.kind === "project" && (
            <span className="inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {copy.taskForm.kinds.project}
            </span>
          )}
          {task.kind === "project" && progress && progress.total > 0 && (
            <span className="text-xs font-medium tabular-nums text-primary/90">{progress.done}/{progress.total}</span>
          )}
          {task.kind === "project" && onOpenProject && (
            <button onClick={onOpenProject} className="text-xs font-semibold text-primary underline underline-offset-2">
              {copy.project.viewPlan}
            </button>
          )}
          {task.kind === "reminder" && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <Bell className="h-2.5 w-2.5" />
              {copy.taskForm.kinds.reminder}
            </span>
          )}
          {task.kind !== "reminder" && (
            <span className="text-xs text-muted-foreground">{getTaskDurationLabel(task.estimateMin)}</span>
          )}
          {task.seriesId && (
            <Repeat className="h-3 w-3 text-muted-foreground" aria-label={copy.taskList.repeats}>
              <title>{copy.taskList.repeats}</title>
            </Repeat>
          )}
          <PriorityPill priority={task.priority} language={language} />
          {steps.length > 0 && (
            <span className="text-xs font-medium text-primary/90">
              {steps.filter((s) => s.done).length}/{steps.length}
            </span>
          )}
        </div>
        {extra}
      </div>

      <div className="flex flex-shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {canFocusTask(task) && (
          <button
            onClick={onFocus}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-primary"
            aria-label={focusT.focus}
            title={focusT.focus}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={onEdit}
          disabled={isMutating}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          aria-label={copy.taskList.edit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          disabled={isMutating}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          aria-label={copy.common.delete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.li>
  );
}

// Height/opacity transition so content unfolds instead of popping in.
function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <motion.div
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden"
      aria-hidden={!open}
      inert={!open}
    >
      {children}
    </motion.div>
  );
}

function CollapsibleWeeks({ open, position, children }: { open: boolean; position: "before" | "after"; children: ReactNode }) {
  return (
    <Collapsible open={open}>
      <div className={cn("grid grid-cols-7 gap-x-0.5 gap-y-0.5", position === "before" ? "pb-0.5" : "pt-0.5")}>{children}</div>
    </Collapsible>
  );
}
