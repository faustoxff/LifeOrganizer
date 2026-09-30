"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChecklistOp, TaskChecklist } from "@/lib/checklist";
import {
  DEFAULT_LEAD_MIN,
  dueChecklistReminders,
  pendingItems,
  readLead,
  reminderEnabled,
  shouldOffer,
  type ReminderPreference
} from "@/lib/checklist-reminder";
import { copy as appCopy, type AppLanguage } from "@/lib/i18n";
import { getTodayDateValue } from "@/lib/task-date";
import { addDays } from "@/lib/recurrence";
import { isDespistado, type UserFact } from "@/lib/user-facts";
import { showNotification } from "@/lib/use-reminders";
import type { UserPlan } from "@/lib/use-user-plan";
import type { Task } from "@/types/task";

/**
 * Las checklists de "no te olvides" en el cliente: qué tareas tienen una, cargarla y editarla,
 * y el aviso antes de la hora. Solo Plus/Pro; con Free no hace ninguna llamada.
 */

const preferenceKey = (userId: string) => `spark-checklist-reminder_${userId}`;
const leadKey = (userId: string) => `spark-checklist-lead_${userId}`;
const firedKey = (userId: string) => `spark-checklist-fired_${userId}`;
const CHECK_EVERY_MS = 60_000;
/** Cuántos días hacia adelante se detecta la actividad de las tareas. */
const DETECT_DAYS = 7;
/** Cuántas checklists de hoy se arman de antemano para tener qué mostrar en el aviso. */
const PRELOAD_MAX = 5;

export type ChecklistState = "idle" | "loading";

export type ChecklistsApi = {
  enabled: boolean;
  /** La actividad de una tarea, o null si no tiene (o todavía no se sabe). */
  activityOf: (taskId: string) => string | null;
  checklistOf: (taskId: string) => TaskChecklist | null;
  isLoading: (taskId: string) => boolean;
  /** Por qué la lista vino vacía: sin cupo o la IA falló. */
  degradedOf: (taskId: string) => "limit" | "ai_failed" | null;
  load: (taskId: string, force?: boolean) => Promise<void>;
  edit: (taskId: string, change: ChecklistOp) => Promise<boolean>;
  dismiss: (taskId: string) => Promise<void>;
  preference: ReminderPreference;
  reminderActive: boolean;
  offerReminder: boolean;
  setPreference: (value: "on" | "off") => void;
  leadMin: number;
  setLeadMin: (value: number) => void;
  /** Las tareas con la checklist que ya se cargó, para quien las muestre. */
  merge: (tasks: Task[]) => Task[];
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked */
  }
}

export function useChecklists(input: {
  tasks: Task[];
  plan: UserPlan;
  planLoaded: boolean;
  userId: string;
  language: AppLanguage;
  notificationsGranted: boolean;
}): ChecklistsApi {
  const { tasks, plan, planLoaded, userId, language, notificationsGranted } = input;
  const enabled = planLoaded && plan !== "free";

  const [activities, setActivities] = useState<Record<string, string | null>>({});
  const [checklists, setChecklists] = useState<Record<string, TaskChecklist>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [degraded, setDegraded] = useState<Record<string, "limit" | "ai_failed">>({});
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [preference, setPreferenceState] = useState<ReminderPreference>(null);
  const [leadMin, setLeadState] = useState(DEFAULT_LEAD_MIN);

  const asked = useRef(new Set<string>());
  const preloaded = useRef(new Set<string>());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const checklistsRef = useRef(checklists);
  checklistsRef.current = checklists;

  useEffect(() => {
    const stored = readStorage(preferenceKey(userId));
    setPreferenceState(stored === "on" || stored === "off" ? stored : null);
    setLeadState(readLead(readStorage(leadKey(userId))));
  }, [userId]);

  // Lo que el servidor ya armó viene con la tarea: no hace falta preguntar.
  useEffect(() => {
    if (!enabled) return;
    const known: Record<string, string> = {};
    for (const task of tasks) if (task.checklist) known[task.id] = task.checklist.activityKey;
    if (Object.keys(known).length > 0) setActivities((prev) => ({ ...known, ...prev }));
  }, [enabled, tasks]);

  // Hechos: solo para saber si es despistado (define si el aviso está activo por defecto).
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch("/api/facts")
      .then((res) => (res.ok ? (res.json() as Promise<{ facts: UserFact[] }>) : null))
      .then((data) => {
        if (active && data) setFacts(data.facts);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled]);

  // Detectar la actividad de las tareas de esta semana que todavía no se clasificaron.
  useEffect(() => {
    if (!enabled) return;
    const today = getTodayDateValue();
    const horizon = addDays(today, DETECT_DAYS);
    const fresh = tasks
      .filter((t) => !t.done && t.status !== "skipped" && t.kind !== "project" && t.dueDate <= horizon)
      .filter((t) => !asked.current.has(t.id) && !t.checklist)
      .slice(0, 30);
    if (fresh.length === 0) return;
    for (const t of fresh) asked.current.add(t.id);

    void fetch("/api/checklists/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: fresh.map((t) => ({ id: t.id, title: t.title, kind: t.kind })), uiLanguage: language })
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ activities: Record<string, string | null> }>) : null))
      .then((data) => {
        if (data) setActivities((prev) => ({ ...prev, ...data.activities }));
      })
      .catch(() => {});
  }, [enabled, tasks, language]);

  const load = useCallback(
    async (taskId: string, force = false) => {
      if (!force && checklistsRef.current[taskId]) return;
      setLoading((prev) => ({ ...prev, [taskId]: true }));
      try {
        const res = await fetch("/api/checklists/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, uiLanguage: language })
        });
        if (!res.ok) return;
        const data = (await res.json()) as { checklist: TaskChecklist | null; degraded?: "limit" | "ai_failed" };
        if (data.checklist) setChecklists((prev) => ({ ...prev, [taskId]: data.checklist! }));
        else setActivities((prev) => ({ ...prev, [taskId]: null }));
        setDegraded((prev) => {
          const next = { ...prev };
          if (data.degraded) next[taskId] = data.degraded;
          else delete next[taskId];
          return next;
        });
      } catch {
        /* the panel stays empty and offers a retry */
      } finally {
        setLoading((prev) => ({ ...prev, [taskId]: false }));
      }
    },
    [language]
  );

  const edit = useCallback(
    async (taskId: string, change: ChecklistOp): Promise<boolean> => {
      try {
        const res = await fetch("/api/checklists/task", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, ...change })
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { checklist: TaskChecklist };
        setChecklists((prev) => ({ ...prev, [taskId]: data.checklist }));
        setDegraded((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const dismiss = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/checklists/task?taskId=${encodeURIComponent(taskId)}`, { method: "DELETE" });
      if (!res.ok) return;
      setActivities((prev) => ({ ...prev, [taskId]: null }));
      setChecklists((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    } catch {
      /* nothing changed */
    }
  }, []);

  const despistado = useMemo(() => isDespistado(facts), [facts]);
  const reminderActive = reminderEnabled(preference, despistado);
  const offerReminder = shouldOffer(preference, despistado);

  const setPreference = useCallback(
    (value: "on" | "off") => {
      setPreferenceState(value);
      writeStorage(preferenceKey(userId), value);
    },
    [userId]
  );
  const setLeadMin = useCallback(
    (value: number) => {
      setLeadState(readLead(value));
      writeStorage(leadKey(userId), String(readLead(value)));
    },
    [userId]
  );

  const merge = useCallback((list: Task[]) => list.map((t) => (checklists[t.id] ? { ...t, checklist: checklists[t.id] } : t)), [checklists]);

  // Con el aviso activo, las checklists de las tareas de hoy con hora se arman de antemano:
  // el aviso tiene que saber qué listar cuando llegue el momento.
  useEffect(() => {
    if (!enabled || !reminderActive) return;
    const today = getTodayDateValue();
    const due = tasks
      .filter((t) => !t.done && t.status !== "skipped" && t.dueDate === today && t.time && activities[t.id] && !checklists[t.id] && !t.checklist)
      .filter((t) => !preloaded.current.has(t.id))
      .slice(0, PRELOAD_MAX);
    for (const t of due) {
      preloaded.current.add(t.id);
      void load(t.id);
    }
  }, [enabled, reminderActive, tasks, activities, checklists, load]);

  // El aviso: desde `leadMin` minutos antes de la hora, una vez por tarea.
  useEffect(() => {
    if (!enabled || !reminderActive || !notificationsGranted) return;

    function check() {
      const now = new Date();
      const today = getTodayDateValue();
      let fired = new Set<string>();
      try {
        const stored = JSON.parse(readStorage(firedKey(userId)) ?? "null") as { date: string; ids: string[] } | null;
        if (stored?.date === today) fired = new Set(stored.ids);
      } catch {
        /* start empty */
      }
      const merged = tasksRef.current.map((t) => (checklistsRef.current[t.id] ? { ...t, checklist: checklistsRef.current[t.id] } : t));
      const due = dueChecklistReminders({ tasks: merged, today, nowMinutes: now.getHours() * 60 + now.getMinutes(), leadMin, fired });
      if (due.length === 0) return;

      const t = appCopy[language].checklist;
      for (const task of due) {
        showNotification(t.notifTitle(task.title, task.time ?? ""), t.notifBody(pendingItems(task.checklist).join(", ")));
        fired.add(task.id);
      }
      writeStorage(firedKey(userId), JSON.stringify({ date: today, ids: [...fired] }));
    }

    check();
    const id = window.setInterval(check, CHECK_EVERY_MS);
    return () => window.clearInterval(id);
  // `checklists` está en las dependencias para revisar apenas llega una checklist recién armada,
  // en vez de esperar al próximo minuto.
  }, [enabled, reminderActive, notificationsGranted, leadMin, language, userId, checklists]);

  return {
    enabled,
    activityOf: (taskId) => activities[taskId] ?? null,
    checklistOf: (taskId) => checklists[taskId] ?? null,
    isLoading: (taskId) => loading[taskId] === true,
    degradedOf: (taskId) => degraded[taskId] ?? null,
    load,
    edit,
    dismiss,
    preference,
    reminderActive,
    offerReminder,
    setPreference,
    leadMin,
    setLeadMin,
    merge
  };
}
