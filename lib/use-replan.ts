"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ReplanMoveView = { id: string; taskId: string; title: string; from: string; to: string };

type Params = {
  /** Cuando las tareas ya se cargaron (el replan diario corrió en esa misma carga). */
  enabled: boolean;
  /** Se llama cuando algo cambió en el servidor y hay que recargar las tareas. */
  onChanged: () => void | Promise<void>;
};

/**
 * El aviso del replan: lo que se movió y el usuario todavía no vio, y las acciones (deshacer, cerrar, resolver
 * un recordatorio vencido o un conflicto). Todo es del usuario autenticado; el cliente solo manda ids.
 */
export function useReplan({ enabled, onChanged }: Params) {
  const [moves, setMoves] = useState<ReplanMoveView[]>([]);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/replan");
      if (!res.ok) return;
      const data = (await res.json()) as { moves?: ReplanMoveView[] };
      setMoves(Array.isArray(data.moves) ? data.moves : []);
    } catch {
      /* el aviso es un extra: nunca rompe la pantalla */
    }
  }, []);

  useEffect(() => {
    if (!enabled || loaded.current) return;
    loaded.current = true;
    void refresh();
  }, [enabled, refresh]);

  const post = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch("/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Cierra el aviso: queda como visto y no vuelve. */
  const dismiss = useCallback(async () => {
    setMoves([]);
    await post({ action: "seen" });
  }, [post]);

  /** Deshace un movimiento: la tarea vuelve a su día. */
  const undo = useCallback(
    async (moveId: string) => {
      setMoves((prev) => prev.filter((m) => m.id !== moveId));
      if (await post({ action: "undo", moveId })) await changedRef.current();
      else await refresh();
    },
    [post, refresh]
  );

  /** Un recordatorio o una tarea con hora vencida: hecho, pasar a mañana o descartar. */
  const resolveFixed = useCallback(
    async (taskId: string, op: "done" | "tomorrow" | "dismiss") => {
      if (await post({ action: "fixed", taskId, op })) await changedRef.current();
    },
    [post]
  );

  /** Un conflicto: correr la fecha límite unos días, o sumar minutos por día. */
  const resolveConflict = useCallback(
    async (input: { op: "extend"; taskId: string; days: number } | { op: "minutes"; minutes: number }) => {
      if (await post({ action: "resolve", ...input })) {
        await changedRef.current();
        await refresh();
      }
    },
    [post, refresh]
  );

  return { moves, busy, refresh, dismiss, undo, resolveFixed, resolveConflict };
}

export type ReplanApi = ReturnType<typeof useReplan>;
