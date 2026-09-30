"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  blockKeyOf,
  collectBusyBlocks,
  DEFAULT_PREP,
  getFreeWindow,
  mergeBlocks,
  readPrep,
  type BusyBlock,
  type FreeWindow,
  type PrepSettings
} from "@/lib/busy-blocks";
import { capacityOn, type Availability } from "@/lib/availability";
import { addDays } from "@/lib/recurrence";
import {
  getRecommendations,
  isChoiceValid,
  MORE_MIN,
  sessionCandidate,
  withAvailableMinutes,
  type ManualChoice,
  type Recommendation
} from "@/lib/recommendation";
import { getDeviceTimeZone } from "@/lib/task-date";
import type { UserPatterns } from "@/lib/user-patterns";
import type { Task } from "@/types/task";

export type NowChoice = "15" | "30" | "60" | "more";
const CHOICE_MIN: Record<NowChoice, number> = { "15": 15, "30": 30, "60": 60, more: MORE_MIN };

/** Cada cuánto se recalcula "ahora" (el tiempo libre baja solo mientras pasa el rato). */
const TICK_MS = 30_000;
/** Cada cuánto se piden los compromisos de fuentes externas. */
const EXTERNAL_REFRESH_MS = 5 * 60_000;

export type NowSession = { subtaskId: string; title: string; minutes: number; deadline: string; late?: boolean };

export type NowView = {
  timeZone: string;
  now: Date;
  /** La ventana con la corrección manual ya aplicada. */
  window: FreeWindow;
  blocks: BusyBlock[];
  options: Recommendation[];
  index: number;
  current: Recommendation;
  manual: NowChoice | null;
  tired: boolean;
  setManual: (choice: NowChoice | null) => void;
  toggleTired: () => void;
  /** "Otra": la siguiente opción; después de la última vuelve a la primera. */
  other: () => void;
};

type Params = {
  /** Solo los planes que ya tenían la recomendación (Plus/Pro). */
  enabled: boolean;
  /** Tareas que pueden competir (sin filas de proyecto: compiten por sus sesiones). */
  tasks: readonly Task[];
  /** Todas las tareas visibles (para sacar los bloques con hora, también los recordatorios). */
  allTasks: readonly Task[];
  sessions: readonly NowSession[];
  availability: Availability;
  patterns: UserPatterns | null;
  today: string;
};

/**
 * "Qué hago ahora": junta los compromisos con hora, la ventana libre, lo que el usuario corrigió a mano y las
 * tareas, y le pide la recomendación a la misma función que usa Milo. Una corrección manual vale hasta que
 * cambia el próximo bloque o pasan 60 minutos.
 */
export function useNow({ enabled, tasks, allTasks, sessions, availability, patterns, today }: Params): NowView | null {
  const timeZone = useMemo(() => getDeviceTimeZone(), []);
  const [now, setNow] = useState(() => new Date());
  const [prep, setPrep] = useState<PrepSettings>(DEFAULT_PREP);
  const [external, setExternal] = useState<BusyBlock[]>([]);
  const [manual, setManualState] = useState<{ value: NowChoice; choice: ManualChoice } | null>(null);
  const [tiredChoice, setTiredChoice] = useState<ManualChoice | null>(null);
  const [cursor, setCursor] = useState<{ signature: string; index: number }>({ signature: "", index: 0 });

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/settings/prep")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { calendarMin?: unknown; reminderMin?: unknown } | null) => {
        if (data) setPrep(readPrep(data.calendarMin, data.reminderMin));
      })
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      fetch(`/api/busy?from=${today}&to=${addDays(today, 1)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { blocks?: BusyBlock[] } | null) => {
          if (alive && data?.blocks) setExternal(data.blocks);
        })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, EXTERNAL_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, today]);

  const blocks = useMemo(
    () => mergeBlocks(collectBusyBlocks(allTasks, { timeZone, from: today, to: addDays(today, 1), prep }), external),
    [allTasks, timeZone, today, prep, external]
  );

  const baseWindow = useMemo(
    () => getFreeWindow({ now, blocks, timeZone, dayCapacityMin: capacityOn(today, availability) }),
    [now, blocks, timeZone, today, availability]
  );

  const manualValid = manual && isChoiceValid(manual.choice, baseWindow, now) ? manual : null;
  const tired = isChoiceValid(tiredChoice, baseWindow, now);
  const window_ = manualValid ? withAvailableMinutes(baseWindow, CHOICE_MIN[manualValid.value]) : baseWindow;

  const candidates = useMemo<Task[]>(
    () => [
      ...tasks.filter((t) => t.kind !== "project"),
      ...sessions.map((s) =>
        sessionCandidate({ subtaskId: s.subtaskId, title: s.title, minutes: s.minutes, deadline: s.deadline, priority: s.late ? "high" : "medium" })
      )
    ],
    [tasks, sessions]
  );

  const options = useMemo(
    () => getRecommendations(candidates, { now, timeZone, window: window_, energy: tired ? "tired" : undefined, patterns }),
    [candidates, now, timeZone, window_, tired, patterns]
  );

  // El cursor de "Otra" vuelve a 0 cuando cambia el conjunto de opciones (otro bloque, otra tarea…).
  const signature = options.map((o) => (o.type === "task" ? `${o.task.id}:${o.mode}` : o.type)).join("|");
  const index = cursor.signature === signature ? cursor.index % options.length : 0;

  const setManual = useCallback(
    (choice: NowChoice | null) => {
      if (choice === null || manualValid?.value === choice) {
        setManualState(null);
        return;
      }
      // El reloj de la vista se pone al día junto con la elección, para que "ahora" nunca quede antes de ella.
      const at = new Date();
      setNow(at);
      setManualState({ value: choice, choice: { setAt: at.getTime(), blockKey: blockKeyOf(baseWindow) } });
    },
    [baseWindow, manualValid?.value]
  );

  const toggleTired = useCallback(() => {
    const at = new Date();
    setNow(at);
    setTiredChoice(tired ? null : { setAt: at.getTime(), blockKey: blockKeyOf(baseWindow) });
  }, [baseWindow, tired]);

  const other = useCallback(() => setCursor({ signature, index: index + 1 }), [signature, index]);

  if (!enabled) return null;
  return {
    timeZone,
    now,
    window: window_,
    blocks,
    options,
    index,
    current: options[index],
    manual: manualValid?.value ?? null,
    tired,
    setManual,
    toggleTired,
    other
  };
}
