"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Bell, Brain, Clock, LogOut, Zap, X, ArrowUpRight, ListChecks, MessageCircle, PanelLeft } from "lucide-react";
import { AvailabilityDialog } from "@/components/availability-dialog";
import { CalendarView } from "@/components/calendar-view";
import { FocusMode } from "@/components/focus-mode";
import { GemUnlock } from "@/components/gem-unlock";
import { ProjectAlerts } from "@/components/project-alerts";
import { ProjectDetail } from "@/components/project-detail";
import { HowLongDialog, getTodaySessions, TodayProjectSessions, type TodaySession } from "@/components/project-sessions";
import { ProjectWizard } from "@/components/project-wizard";
import { useAuth } from "@/components/auth-gate";
import { useAppLanguage } from "@/components/language-provider";
import { MiloChat } from "@/components/milo-chat";
import { PlanZapIcon } from "@/components/plan-zap-icon";
import { ScopeDialog } from "@/components/scope-dialog";
import { getUserDisplayName } from "@/lib/auth";
import { DEFAULT_AVAILABILITY, parseAvailability, type Availability } from "@/lib/availability";
import { TaskChecklist } from "@/components/task-checklist";
import { TaskForm, type ProjectStartInput } from "@/components/task-form";
import { Button } from "@/components/ui/button";
import { TextAnimate } from "@/components/ui/text-animate";
import { formatTodayLongDate, getDeviceTimeZone, getTodayDateValue } from "@/lib/task-date";
import { celebrate } from "@/lib/celebrate";
import { getCurrentBadge, getStreakFromCompletions } from "@/lib/streak";
import { DEFAULT_ESTIMATE_MIN } from "@/lib/task-estimate";
import { getSkippedDates, isFutureOccurrence, isRecommendable, isSkipped } from "@/lib/task-views";
import type { EditScope } from "@/lib/task-validation";
import { focusCopy, reminderCopy } from "@/lib/focus-copy";
import { useChecklists } from "@/lib/use-checklists";
import { usePatterns } from "@/lib/use-patterns";
import { useReminders } from "@/lib/use-reminders";
import { useUserPlan } from "@/lib/use-user-plan";
import { AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { AiPriorityApiResponse, AiPriorityRecommendation } from "@/types/ai-priority";
import type { ProjectView } from "@/types/project";
import { Task, TaskInput, TaskStep } from "@/types/task";

const FALLBACK_STORAGE_ERROR_MESSAGE = "An unexpected error occurred.";
const FREE_PLAN_LIMIT_PREFIX = "FREE_PLAN_LIMIT:";
const CHAT_OPEN_KEY = "spark-chat-open";
// Highest milestone already celebrated, per account, so it never repeats.
const celebratedKey = (userId: string) => `spark-gem-celebrated_${userId}`;
// Se muestra una sola vez: avisar "tu prueba terminó" en cada sesión para
// siempre sería hostil, pero sin avisarlo nunca el usuario baja a Free sin
// enterarse. Se recordó por usuario, así otro dispositivo del mismo equipo
// no lo vuelve a mostrar.
const trialNoticeKey = (userId: string) => `spark-trial-notice-seen_${userId}`;

export function LifeOrganizerApp() {
  const { copy, language } = useAppLanguage();
  const { user, logout } = useAuth();
  const displayName = getUserDisplayName(user);
  const { plan, trialDaysLeft, trialEnded, isLoaded: planLoaded } = useUserPlan();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [taskLimitReached, setTaskLimitReached] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState<AiPriorityRecommendation | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Projects: the plans the scheduler keeps for the user, and what is open on top of them.
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [projectsBusy, setProjectsBusy] = useState(false);
  const [wizardStart, setWizardStart] = useState<ProjectStartInput | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [focusSession, setFocusSession] = useState<TodaySession | null>(null);
  // Set when a focus session ended without the timer: we still owe "how long did it take?".
  const [askHowLong, setAskHowLong] = useState<string | null>(null);
  // How much time per day the user can give their pending work. `configured`
  // false means they never set it: the first visit shows the onboarding step.
  const [availability, setAvailability] = useState<{ values: Availability; configured: boolean } | null>(null);
  const [availabilityDialog, setAvailabilityDialog] = useState<"onboarding" | "settings" | null>(null);
  // Editing or deleting one occurrence of a repeating task asks for the scope
  // first; the action waits here until the user picks.
  const [scopePrompt, setScopePrompt] = useState<
    { action: "edit"; input: TaskInput } | { action: "delete"; taskId: string } | null
  >(null);
  // On small screens the tasks and the Milo chat are separate tabs; on desktop both are visible.
  const [mobileTab, setMobileTab] = useState<"tasks" | "chat">("tasks");
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [breakingDownTaskId, setBreakingDownTaskId] = useState<string | null>(null);
  const [unlockedGem, setUnlockedGem] = useState<{ level: number; days: number } | null>(null);
  // Desktop only: the chat can be put away so the screen holds one thing at a time.
  const [chatOpen, setChatOpen] = useState(true);

  // Se arranca oculto: si la arrancara visible habría un flash del aviso en
  // usuarios que ya lo vieron antes de que el effect lea localStorage.
  const [trialNoticeSeen, setTrialNoticeSeen] = useState(true);

  useEffect(() => {
    if (!trialEnded) return;
    try {
      setTrialNoticeSeen(localStorage.getItem(trialNoticeKey(user.id)) === "1");
    } catch {
      /* storage can be blocked — el aviso se muestra una vez igual */
    }
  }, [trialEnded, user.id]);

  function dismissTrialNotice() {
    setTrialNoticeSeen(true);
    try {
      localStorage.setItem(trialNoticeKey(user.id), "1");
    } catch {
      /* storage can be blocked */
    }
  }

  useEffect(() => {
    try {
      setChatOpen(localStorage.getItem(CHAT_OPEN_KEY) !== "0");
    } catch {
      /* storage can be blocked */
    }
  }, []);

  function toggleChat(next: boolean) {
    setChatOpen(next);
    try {
      localStorage.setItem(CHAT_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* storage can be blocked */
    }
  }

  const aiRecommendationCacheRef = useRef(new Map<string, AiPriorityRecommendation>());
  const todayLabel = formatTodayLongDate(language);

  // The browser's timezone travels with every load: the server stores it and
  // uses it for "today", and the same request brings the series up to date
  // (skips what fell behind, creates the next two weeks).
  async function fetchTasks() {
    const res = await fetch(`/api/tasks?tz=${encodeURIComponent(getDeviceTimeZone())}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { tasks: Task[] };
    return data.tasks;
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const loaded = await fetchTasks();
        if (active) { setTasks(loaded); setStorageError(""); }
      } catch (err) {
        if (active) setStorageError(getErrorMessage(err, FALLBACK_STORAGE_ERROR_MESSAGE));
      } finally {
        if (active) setIsLoaded(true);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadAvailability() {
      try {
        const res = await fetch("/api/settings/availability");
        if (!res.ok) return;
        const data = (await res.json()) as { availability?: unknown; configured?: unknown };
        const values = parseAvailability(data.availability);
        if (!active || !values) return;
        const configured = data.configured === true;
        setAvailability({ values, configured });
        if (!configured) setAvailabilityDialog("onboarding");
      } catch {
        /* the app works without it; the dialog just does not show */
      }
    }
    void loadAvailability();
    return () => { active = false; };
  }, []);

  // Projects and their agenda. The first load of the day replans on the server (once
  // per user per day); every later action replans on its own.
  useEffect(() => {
    let active = true;
    async function loadProjects() {
      try {
        const res = await fetch(`/api/projects?tz=${encodeURIComponent(getDeviceTimeZone())}`);
        if (!res.ok) return;
        const data = (await res.json()) as { projects?: ProjectView[] };
        if (active && Array.isArray(data.projects)) setProjects(data.projects);
      } catch {
        /* projects are additive: the rest of the app works without them */
      }
    }
    void loadProjects();
    return () => { active = false; };
  }, []);

  /** Re-reads the availability after an action changed it (e.g. "add minutes per day"). */
  async function refreshAvailability() {
    try {
      const res = await fetch("/api/settings/availability");
      if (!res.ok) return;
      const data = (await res.json()) as { availability?: unknown };
      const values = parseAvailability(data.availability);
      if (values) setAvailability({ values, configured: true });
    } catch {
      /* it will be re-read on the next load */
    }
  }

  async function handleSaveAvailability(values: Availability) {
    try {
      const res = await fetch("/api/settings/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: values })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAvailability({ values, configured: true });
      setStorageError("");
      return true;
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
      return false;
    }
  }

  // Several rows can change at once (a series was cut and another created), so
  // those operations reload instead of patching local state row by row.
  async function reloadTasks() {
    try {
      setTasks(await fetchTasks());
      setStorageError("");
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
    }
  }

  const today = getTodayDateValue();

  // A skipped occurrence is history nobody needs to see: it is out of the
  // calendar, the list, the counts and the AI, but its day still counts for the
  // streak (as neutral) so it is kept in `tasks`.
  const visibleTasks = useMemo(() => tasks.filter((t) => !isSkipped(t)), [tasks]);
  // What "today" works with: no skipped rows and no future occurrences. Milo,
  // the reminder nudge and the recommendation only look at this.
  const todayTasks = useMemo(
    () => visibleTasks.filter((t) => !isFutureOccurrence(t, today)),
    [visibleTasks, today]
  );
  const pendingTasks = useMemo(
    () => visibleTasks.filter((t) => isRecommendable(t, today)),
    [visibleTasks, today]
  );

  // Today's project sessions compete for the recommendation like any other pending
  // work; a plan that is running late weighs more.
  const todaySessions = useMemo(() => getTodaySessions(projects, today), [projects, today]);

  const aiRequestTasks = useMemo(() =>
    [
      ...pendingTasks.map(({ id, title, category, description, priority, estimateMin, dueDate }) =>
        ({ id, title, category, description, priority, estimateMin, dueDate })
      ),
      ...todaySessions.map(({ session, subtask, project }) => ({
        id: `session:${subtask.id}`,
        title: `${project.task.title}: ${subtask.title}`,
        category: "project",
        description: "",
        priority: (project.plan && (!project.plan.feasible || project.plan.bufferConsumedPct > 50) ? "high" : "medium") as Task["priority"],
        estimateMin: session.minutes,
        dueDate: project.task.dueDate
      }))
    ].sort((a, b) => a.id.localeCompare(b.id)),
    [pendingTasks, todaySessions]
  );
  const recommendedSubtaskId = aiRecommendation?.recommendedTaskId.startsWith("session:")
    ? aiRecommendation.recommendedTaskId.slice("session:".length)
    : null;
  const projectProgress = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.task.id, p.progress])),
    [projects]
  );
  const detailProject = detailProjectId ? projects.find((p) => p.task.id === detailProjectId) ?? null : null;

  const aiRequestKey = useMemo(() =>
    JSON.stringify({ language, tasks: aiRequestTasks }),
    [aiRequestTasks, language]
  );

  useEffect(() => {
    if (!isLoaded) return;
    if (aiRequestTasks.length === 0) { setAiRecommendation(null); setIsAiLoading(false); return; }

    const cached = aiRecommendationCacheRef.current.get(aiRequestKey);
    if (cached) { setAiRecommendation(cached); setIsAiLoading(false); return; }

    setAiRecommendation(null);
    setIsAiLoading(true);
    const ctrl = new AbortController();

    async function loadRec() {
      try {
        const res = await fetch("/api/ai-priority", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: aiRequestTasks, uiLanguage: language }),
          signal: ctrl.signal
        });
        const data = (await res.json()) as AiPriorityApiResponse;
        if (data.enabled && data.recommendation) {
          aiRecommendationCacheRef.current.set(aiRequestKey, data.recommendation);
          setAiRecommendation(data.recommendation);
        } else {
          setAiRecommendation(null);
        }
      } catch {
        if (!ctrl.signal.aborted) setAiRecommendation(null);
      } finally {
        if (!ctrl.signal.aborted) setIsAiLoading(false);
      }
    }
    void loadRec();
    return () => ctrl.abort();
  }, [aiRequestKey, aiRequestTasks, isLoaded, language]);

  const reminders = useReminders(todayTasks, language, isLoaded, user.id);

  // Permiso de notificaciones para el aviso de la checklist. Se pide aparte del aviso diario: activar
  // uno no debe prender el otro.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setNotifPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  const enableChecklistNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    setNotifPermission(await Notification.requestPermission());
  }, []);
  // La pista de "solés tardar ~N" solo hace falta con el formulario abierto.
  const patterns = usePatterns(showForm);
  const checklists = useChecklists({
    tasks,
    plan,
    planLoaded: planLoaded,
    userId: user.id,
    language,
    notificationsGranted: notifPermission === "granted"
  });
  const focusTask = focusTaskId ? tasks.find((t) => t.id === focusTaskId) ?? null : null;
  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) ?? null : null;

  async function handleCreateTask(input: TaskInput) {
    setIsSyncing(true);
    try {
      // With `repeat` the server creates a series instead of a single task.
      const newTask = { id: crypto.randomUUID(), ...input, done: false, status: "pending" };
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTask)
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // Two different 403s arrive at the same status: the Free plan's
        // 15-task cap, and the 1000-task cap that applies to every plan. Only
        // the first one may show the Free/upgrade banner — a paying subscriber
        // who hit 1000 tasks was told they were on the Free plan, which is
        // simply not true. Anything else falls through to the generic message
        // rather than a false one.
        const isFreePlanLimit =
          typeof body?.error === "string" && body.error.startsWith(FREE_PLAN_LIMIT_PREFIX);
        setTaskLimitReached(isFreePlanLimit);
        setStorageError(isFreePlanLimit ? "" : copy.errors.unexpected);
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { task: Task | null; tasks?: Task[] };
      // A series answers with its first occurrences; a plain task with one row.
      const created = data.tasks ?? (data.task ? [data.task] : []);
      setTasks((prev) => {
        const ids = new Set(created.map((t) => t.id));
        return [...created, ...prev.filter((t) => !ids.has(t.id))];
      });
      setStorageError("");
      setTaskLimitReached(false);
      return true;
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
      setTaskLimitReached(false);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }

  // Only a pending occurrence can be cut ("this and the following"); a done one
  // has already happened, so it is just edited.
  const hasScope = (task: Task | undefined) =>
    Boolean(task?.seriesId) && task?.status === "pending" && !task?.done;

  async function handleUpdateTask(input: TaskInput) {
    if (!editingTaskId) return false;
    const current = tasks.find((t) => t.id === editingTaskId);
    if (!current) { setEditingTaskId(null); return false; }
    if (hasScope(current)) {
      // Not saved yet: the form stays open behind the dialog.
      setScopePrompt({ action: "edit", input });
      return false;
    }
    return saveTaskEdit(current, input, "this");
  }

  async function saveTaskEdit(current: Task, input: TaskInput, scope: EditScope) {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, ...input, scope })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { task?: Task; reload?: boolean };
      if (data.reload) {
        await reloadTasks();
      } else if (data.task) {
        const updated = data.task;
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      }
      setEditingTaskId(null);
      setShowForm(false);
      setStorageError("");
      return true;
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
      return false;
    } finally {
      setIsSyncing(false);
    }
  }

  /**
   * `focusMinutes`: lo que midió el modo foco al completar. Solo viaja cuando la tarea se
   * completa desde ahí: con un tilde no se manda nada y no se inventa un tiempo.
   */
  async function handleToggleTask(taskId: string, focusMinutes?: number) {
    const current = tasks.find((t) => t.id === taskId);
    if (!current) return;
    if (!current.done) void celebrate("task");
    setIsSyncing(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          done: !current.done,
          ...(!current.done && typeof focusMinutes === "number" && focusMinutes > 0 ? { actualMin: focusMinutes } : {})
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { task: Task };
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === data.task.id ? data.task : t));
        if (data.task.done) checkGemUnlock(next);
        return next;
      });
      setStorageError("");
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
    } finally {
      setIsSyncing(false);
    }
  }

  /** Suma a la tarea los minutos de una sesión de foco que se cerró sin completarla. Es un extra: si falla, no molesta. */
  async function addFocusProgress(taskId: string, minutes: number) {
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, progressMin: minutes })
      });
    } catch {
      /* lo medido es un plus: no interrumpe */
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (hasScope(tasks.find((t) => t.id === taskId))) {
      setScopePrompt({ action: "delete", taskId });
      return;
    }
    await deleteTask(taskId, "this");
  }

  async function deleteTask(taskId: string, scope: EditScope) {
    setIsSyncing(true);
    try {
      const res = await fetch(
        `/api/tasks?id=${encodeURIComponent(taskId)}&scope=${scope}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as { reload?: boolean };
      if (editingTaskId === taskId) { setEditingTaskId(null); setShowForm(false); }
      if (data.reload) await reloadTasks();
      else setTasks((prev) => prev.filter((t) => t.id !== taskId));
      // Deleting a project takes its subtasks and agenda with it (cascade on the server).
      setProjects((prev) => prev.filter((p) => p.task.id !== taskId));
      setStorageError("");
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleScopeChoice(scope: EditScope) {
    const prompt = scopePrompt;
    setScopePrompt(null);
    if (!prompt) return;
    if (prompt.action === "delete") {
      await deleteTask(prompt.taskId, scope);
      return;
    }
    const current = tasks.find((t) => t.id === editingTaskId);
    if (current) await saveTaskEdit(current, prompt.input, scope);
  }

  /** Shows the celebration the first time a milestone is reached. */
  function checkGemUnlock(nextTasks: Task[], views: ProjectView[] = projects) {
    // A day spent on a project subtask is a day of work too, so it keeps the streak alive.
    const subtaskDays = views.flatMap((v) => v.subtasks.map((s) => (s.done ? s.doneAt : undefined)));
    // Skipped occurrences ride along so their days neither add to the streak nor break it.
    const streak = getStreakFromCompletions(
      [...nextTasks.map((t) => (t.done ? t.completedAt : undefined)), ...subtaskDays],
      getSkippedDates(nextTasks)
    );
    const badge = getCurrentBadge(streak);
    if (!badge) return;

    let celebrated = 0;
    try {
      celebrated = Number(localStorage.getItem(celebratedKey(user.id)) ?? 0);
    } catch {
      return;
    }
    if (badge.level <= celebrated) return;

    try {
      localStorage.setItem(celebratedKey(user.id), String(badge.level));
    } catch {
      /* storage can be blocked */
    }
    setUnlockedGem({ level: badge.level, days: streak });
  }

  // Persists a task and keeps local state in sync. Used by steps + focus mode.
  async function persistTask(next: Task) {
    setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
    try {
      const res = await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { task: Task };
      setTasks((prev) => prev.map((t) => (t.id === data.task.id ? data.task : t)));
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
    }
  }

  async function handleBreakDown(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || breakingDownTaskId) return;
    setBreakingDownTaskId(taskId);
    try {
      const res = await fetch("/api/ai-task-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, uiLanguage: language })
      });
      const data = (await res.json()) as { steps?: string[] };
      if (!res.ok || !data.steps?.length) {
        setStorageError(res.status === 429 ? focusCopy[language].limit : focusCopy[language].aiError);
        return;
      }
      const steps: TaskStep[] = data.steps.map((text) => ({ id: crypto.randomUUID(), text, done: false }));
      setStorageError("");
      await persistTask({ ...task, steps });
    } catch {
      setStorageError(focusCopy[language].aiError);
    } finally {
      setBreakingDownTaskId(null);
    }
  }

  function handleToggleStep(taskId: string, stepId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.steps) return;
    const steps = task.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s));
    const justCompleted = task.steps.find((s) => s.id === stepId)?.done === false;
    if (justCompleted) void celebrate(steps.every((s) => s.done) ? "task" : "step");
    void persistTask({ ...task, steps });
  }

  // Capture with just a title: everything else gets a sensible default.
  async function handleQuickAdd(title: string) {
    await handleCreateTask({
      title,
      category: "general",
      description: "",
      priority: "medium",
      estimateMin: DEFAULT_ESTIMATE_MIN,
      // The device's calendar day: toISOString() is UTC and is already
      // "tomorrow" in the evening for anyone west of it.
      dueDate: getTodayDateValue(),
      kind: "task"
    });
  }

  /** Runs a project request and swaps in the fresh plans it answers with. */
  async function projectCall(
    url: string,
    method: "PATCH",
    body: Record<string, unknown>
  ): Promise<{ projects: ProjectView[]; projectDone?: boolean } | null> {
    setProjectsBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, tz: getDeviceTimeZone() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects: ProjectView[]; projectDone?: boolean };
      setProjects(data.projects);
      setStorageError("");
      return data;
    } catch (err) {
      setStorageError(getErrorMessage(err, copy.errors.unexpected));
      return null;
    } finally {
      setProjectsBusy(false);
    }
  }

  async function handleSubtaskAction(
    subtaskId: string,
    payload: { action: "complete"; actualMin: number | null } | { action: "progress"; minutes: number } | { action: "skip" }
  ) {
    const data = await projectCall("/api/projects/subtasks", "PATCH", { subtaskId, ...payload });
    if (!data) return;
    if (payload.action === "complete") {
      void celebrate(data.projectDone ? "task" : "step");
      checkGemUnlock(tasks, data.projects);
    }
    // Finishing the last subtask finishes the project task: read it back.
    if (data.projectDone) await reloadTasks();
  }

  async function handleMoveDeadline(projectId: string, deadline: string) {
    const data = await projectCall("/api/projects", "PATCH", { action: "move-deadline", projectId, deadline });
    if (data) await reloadTasks();
  }

  async function handleAddMinutes(extraMin: number) {
    const data = await projectCall("/api/projects", "PATCH", { action: "add-minutes", extraMin });
    if (data) await refreshAvailability();
  }

  async function handleProjectCreated(created: ProjectView[]) {
    setProjects(created);
    await Promise.all([reloadTasks(), refreshAvailability()]);
  }

  function handleStartProject(draft: ProjectStartInput) {
    setEditingTaskId(null);
    setShowForm(false);
    setWizardStart(draft);
  }

  function handleAddTask() {
    setEditingTaskId(null);
    setShowForm(true);
  }

  function handleEditTask(taskId: string) {
    if (isSyncing) return;
    setEditingTaskId(taskId);
    setShowForm(true);
  }

  function handleCloseForm() {
    setEditingTaskId(null);
    setShowForm(false);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Header */}
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => toggleChat(!chatOpen)}
            aria-expanded={chatOpen}
            aria-label={copy.milo.name}
            title={copy.milo.name}
            className="hidden flex-shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:block"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {copy.header.title}
              <PlanZapIcon plan={plan} />
            </p>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg"><TextAnimate text={todayLabel} /></h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plan === "free" ? (
            <Link
              href="/plans"
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-primary/20"
            >
              <Zap className="h-3 w-3" />
              {copy.headerNav.plans}
            </Link>
          ) : (
            <Link
              href="/plans"
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-primary/20"
            >
              <Zap className="h-3 w-3" />
              {plan === "pro" ? "Pro" : "Plus"}
              {trialDaysLeft !== null && (
                <span className="text-primary/70">· {trialDaysLeft}d</span>
              )}
            </Link>
          )}

          {reminders.permission !== "unsupported" && !reminders.optedIn && reminders.permission !== "denied" && (
            <button
              onClick={() => void reminders.enable()}
              className="flex items-center gap-1.5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={reminderCopy[language].enable}
              title={reminderCopy[language].enable}
            >
              <Bell className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={() => setAvailabilityDialog("settings")}
            className="flex items-center gap-1.5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label={copy.availability.open}
            title={copy.availability.open}
          >
            <Clock className="h-4 w-4" />
          </button>

          <Link
            href="/knowledge"
            className="flex items-center gap-1.5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label={copy.knowledge.title}
            title={copy.knowledge.title}
          >
            <Brain className="h-4 w-4" />
          </Link>

          {plan === "pro" && (
            <Link
              href="/stats"
              className="flex items-center gap-1.5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={copy.stats.title}
              title={copy.stats.title}
            >
              <BarChart3 className="h-4 w-4" />
            </Link>
          )}

          <div className="mx-1 h-6 w-px bg-border" />

          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {user.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                getInitials(displayName)
              )}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-muted-foreground">{copy.headerNav.greeting}</span>
              <span className="text-sm font-medium text-foreground">{displayName}</span>
            </div>
          </div>

          <button
            onClick={() => void logout()}
            className="flex items-center gap-1.5 rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={copy.headerNav.logoutLabel}
            title={copy.headerNav.logoutLabel}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {trialEnded && !trialNoticeSeen && (
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs text-foreground sm:px-5">
          <span className="min-w-0">{copy.plans.trialExpired}</span>
          <span className="flex flex-shrink-0 items-center gap-2">
            <Link
              href="/plans"
              className="flex items-center gap-1 font-semibold text-primary underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
            >
              {copy.plans.trialExpiredCta}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
            <button
              onClick={dismissTrialNotice}
              aria-label={copy.plans.trialExpired}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}

      {storageError && (
        <div className="flex-shrink-0 border-b border-border bg-destructive/10 px-5 py-2 text-xs text-destructive">
          {storageError}
        </div>
      )}

      {taskLimitReached && (
        <div className="flex-shrink-0 border-b border-border bg-amber-500/10 px-5 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center justify-between gap-3">
          <span>{copy.plans.taskLimitReached}</span>
          <Link
            href="/plans"
            className="flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
          >
            {copy.plans.upgradeToPro}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <ProjectAlerts
        projects={projects}
        disabled={projectsBusy}
        onOpen={setDetailProjectId}
        onMoveDeadline={(id, deadline) => void handleMoveDeadline(id, deadline)}
        onAddMinutes={(extra) => void handleAddMinutes(extra)}
      />

      {/* Main two-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Milo chat */}
        <div
          className={cn(
            "min-h-0 w-full overflow-hidden transition-[width] duration-300 ease-in-out lg:flex lg:flex-shrink-0",
            mobileTab === "chat" ? "flex" : "hidden",
            chatOpen ? "lg:w-[360px]" : "lg:w-0"
          )}
        >
          <div className="flex w-full lg:w-[360px] lg:flex-shrink-0">
            <MiloChat tasks={todayTasks} onCreateTask={handleCreateTask} />
          </div>
        </div>

        {/* Right: Calendar + tasks */}
        <main className={cn("min-w-0 flex-1 overflow-hidden lg:block", mobileTab === "tasks" ? "block" : "hidden")}>
          <CalendarView
            allTasks={visibleTasks}
            isMutating={isSyncing}
            aiRecommendation={aiRecommendation}
            isAiLoading={isAiLoading}
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
            onEditTask={handleEditTask}
            onToggleTask={handleToggleTask}
            onFocusTask={setFocusTaskId}
            onBreakDown={handleBreakDown}
            breakingDownTaskId={breakingDownTaskId}
            onQuickAdd={handleQuickAdd}
            projectProgress={projectProgress}
            onOpenProject={setDetailProjectId}
            renderTaskExtra={(task) => (
              <TaskChecklist
                task={task}
                api={checklists}
                notifications={{
                  granted: notifPermission === "granted",
                  canAsk: notifPermission === "default",
                  enable: () => void enableChecklistNotifications()
                }}
              />
            )}
            extraPending={todaySessions.length}
            projectSlot={
              <TodayProjectSessions
                sessions={todaySessions}
                recommendedSubtaskId={recommendedSubtaskId}
                disabled={projectsBusy}
                onComplete={(subtaskId, actualMin) => void handleSubtaskAction(subtaskId, { action: "complete", actualMin })}
                onProgress={(subtaskId, minutes) => void handleSubtaskAction(subtaskId, { action: "progress", minutes })}
                onSkip={(subtaskId) => void handleSubtaskAction(subtaskId, { action: "skip" })}
                onFocus={setFocusSession}
                onOpenProject={setDetailProjectId}
              />
            }
          />
        </main>
      </div>

      <AnimatePresence>
        {unlockedGem && (
          <GemUnlock
            level={unlockedGem.level}
            days={unlockedGem.days}
            onClose={() => setUnlockedGem(null)}
          />
        )}
      </AnimatePresence>

      {focusTask && (
        <FocusMode
          task={focusTask}
          isPro={plan === "pro"}
          isBreaking={breakingDownTaskId === focusTask.id}
          // Sin pasos, la tarea también se termina desde acá: es donde se mide cuánto tardó.
          alwaysAllowComplete
          onClose={(elapsedMinutes) => {
            // Cerrar el foco sin terminar no pierde lo trabajado: suma al tiempo medido de la tarea.
            if (elapsedMinutes) void addFocusProgress(focusTask.id, elapsedMinutes);
            setFocusTaskId(null);
          }}
          onBreakDown={() => void handleBreakDown(focusTask.id)}
          onToggleStep={(stepId) => handleToggleStep(focusTask.id, stepId)}
          onCompleteTask={(elapsedMinutes) => { void handleToggleTask(focusTask.id, elapsedMinutes); setFocusTaskId(null); }}
        />
      )}

      {/* Mobile tab bar */}
      <nav className="grid flex-shrink-0 grid-cols-2 border-t border-border bg-background lg:hidden">
        {([
          { id: "tasks", label: copy.calendar.myTasks, Icon: ListChecks },
          { id: "chat", label: copy.milo.name, Icon: MessageCircle }
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setMobileTab(id)}
            aria-current={mobileTab === id ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
              mobileTab === id ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </nav>

      {focusSession && (
        <FocusMode
          task={{
            id: focusSession.subtask.id,
            title: `${focusSession.project.task.title}: ${focusSession.subtask.title}`,
            category: "project",
            description: "",
            priority: "medium",
            estimateMin: focusSession.session.minutes,
            dueDate: today,
            done: false,
            status: "pending",
            kind: "task"
          }}
          isPro={plan === "pro"}
          isBreaking={false}
          alwaysAllowComplete
          hideBreakDown
          onClose={() => setFocusSession(null)}
          onBreakDown={() => {}}
          onToggleStep={() => {}}
          onCompleteTask={(elapsedMinutes) => {
            const subtaskId = focusSession.subtask.id;
            setFocusSession(null);
            // The timer's own time is the real time; without it, ask.
            if (elapsedMinutes) void handleSubtaskAction(subtaskId, { action: "complete", actualMin: elapsedMinutes });
            else setAskHowLong(subtaskId);
          }}
        />
      )}

      {askHowLong && (
        <HowLongDialog
          onCancel={() => setAskHowLong(null)}
          onPick={(minutes) => {
            const subtaskId = askHowLong;
            setAskHowLong(null);
            void handleSubtaskAction(subtaskId, { action: "complete", actualMin: minutes });
          }}
        />
      )}

      {wizardStart && (
        <ProjectWizard
          start={wizardStart}
          onClose={() => setWizardStart(null)}
          onCreated={(created) => void handleProjectCreated(created)}
        />
      )}

      {detailProject && (
        <ProjectDetail
          view={detailProject}
          disabled={projectsBusy}
          onClose={() => setDetailProjectId(null)}
          onComplete={(subtaskId, actualMin) => void handleSubtaskAction(subtaskId, { action: "complete", actualMin })}
          onSkip={(subtaskId) => void handleSubtaskAction(subtaskId, { action: "skip" })}
          onMoveDeadline={(id, deadline) => void handleMoveDeadline(id, deadline)}
          onAddMinutes={(extra) => void handleAddMinutes(extra)}
        />
      )}

      {availabilityDialog && (
        <AvailabilityDialog
          mode={availabilityDialog}
          initial={availability?.values ?? DEFAULT_AVAILABILITY}
          onSave={handleSaveAvailability}
          onClose={() => setAvailabilityDialog(null)}
        />
      )}

      {scopePrompt && (
        <ScopeDialog
          action={scopePrompt.action}
          onChoose={(scope) => void handleScopeChoice(scope)}
          onCancel={() => setScopePrompt(null)}
        />
      )}

      {/* Task form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCloseForm}
              className="absolute -right-2 -top-2 z-10 h-8 w-8 rounded-full bg-secondary"
              aria-label={copy.common.close}
            >
              <X className="h-4 w-4" />
            </Button>
            <TaskForm
              key={editingTask?.id ?? "new"}
              initialValues={editingTask ? {
                title: editingTask.title,
                category: editingTask.category,
                description: editingTask.description,
                priority: editingTask.priority,
                estimateMin: editingTask.estimateMin,
                dueDate: editingTask.dueDate,
                kind: editingTask.kind,
                ...(editingTask.time ? { time: editingTask.time } : {})
              } : undefined}
              isSubmitting={isSyncing}
              mode={editingTask ? "edit" : "create"}
              onCancel={handleCloseForm}
              onSubmitTask={editingTask ? handleUpdateTask : handleCreateTask}
              canCreateProjects={plan !== "free"}
              onStartProject={handleStartProject}
              patterns={patterns}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
