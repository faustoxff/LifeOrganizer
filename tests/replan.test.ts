import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: vi.fn() }));

import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { replanAllWith, type ReplanDeps } from "@/lib/replan";
import { ensureOccurrencesWith, type OccurrenceStore, type SeriesRecord } from "@/lib/series";
import { bestStreakFromDayKeys, streakFromDayKeys } from "@/lib/streak";
import { getSkippedDates } from "@/lib/task-views";
import { isPostponement } from "@/lib/postponement";
import type { PlannedMove, ReplanTask } from "@/lib/task-replan";
import { getTodayInTimeZone } from "@/lib/task-date";

const TODAY = "2026-09-30";
const d = (n: number) => new Date(Date.UTC(2026, 8, 30 + n)).toISOString().slice(0, 10);

type Mem = ReplanTask & { postponedCount: number };
const mk = (id: string, over: Partial<Mem> = {}): Mem => ({
  id, title: id, kind: "task", priority: "medium", estimateMin: 60, dueDate: d(7), done: false, status: "pending", postponedCount: 0, ...over
});

/** Una "base" en memoria con las mismas garantías que el SQL: solo mueve lo que sigue donde se dijo. */
function memory(tasks: Mem[], extra: { extraLoad?: Record<string, number>; hold?: string[]; replanned?: string | null } = {}) {
  const state = { tasks, replannedOn: extra.replanned ?? null, moves: [] as PlannedMove[], projectRuns: 0, conflicts: new Set<string>() };
  const deps: ReplanDeps = {
    getReplannedOn: async () => state.replannedOn,
    markReplanned: async (_u, today) => { state.replannedOn = today; },
    loadContext: async () => ({
      tasks: state.tasks.map((t) => ({ ...t, conflict: state.conflicts.has(t.id) })),
      availability: DEFAULT_AVAILABILITY, overrides: {}, extraLoad: extra.extraLoad ?? {}, hold: new Set(extra.hold ?? [])
    }),
    applyMove: async (_u, move) => {
      const t = state.tasks.find((x) => x.id === move.taskId);
      if (!t || t.pinned || (t.plannedOn ?? t.dueDate) !== move.from) return false;
      if (isPostponement(move.from, move.to)) t.postponedCount += 1;
      t.plannedOn = move.to;
      state.moves.push(move);
      return true;
    },
    setConflicts: async (_u, set, clear) => { set.forEach((id) => state.conflicts.add(id)); clear.forEach((id) => state.conflicts.delete(id)); },
    replanProjects: async () => { state.projectRuns += 1; }
  };
  return { state, deps };
}

describe("replanAll", () => {
  it("mueve lo atrasado al próximo hueco, suma la postergación y NUNCA toca la fecha límite", async () => {
    const t = mk("a", { plannedOn: d(-2), dueDate: d(5) });
    const { state, deps } = memory([t]);
    const report = await replanAllWith(deps, "u1", TODAY);
    expect(report.ran).toBe(true);
    expect(report.moved).toEqual([{ taskId: "a", title: "a", from: d(-2), to: TODAY }]);
    expect(t.plannedOn).toBe(TODAY);
    expect(t.dueDate).toBe(d(5)); // la fecha límite es la misma
    expect(t.postponedCount).toBe(1); // cada movimiento usa la regla de postergación
    expect(state.projectRuns).toBe(1); // y los proyectos corren en el mismo replan
    expect(state.replannedOn).toBe(TODAY);
  });

  it("idempotente: correrlo dos veces el mismo día no cambia nada", async () => {
    const { state, deps } = memory([mk("a", { plannedOn: d(-2) }), mk("b", { plannedOn: d(-1), estimateMin: 90 })]);
    await replanAllWith(deps, "u1", TODAY);
    const snapshot = JSON.stringify(state.tasks);
    const second = await replanAllWith(deps, "u1", TODAY);
    expect(second).toEqual({ ran: false, moved: [], conflicts: [] });
    expect(JSON.stringify(state.tasks)).toBe(snapshot);
    // aun forzándolo (cambio grande), como nada está atrasado no hay nada que mover
    const forced = await replanAllWith(deps, "u1", TODAY, { force: true });
    expect(forced.moved).toEqual([]);
    expect(JSON.stringify(state.tasks)).toBe(snapshot);
    expect(state.moves).toHaveLength(2);
  });

  it("al día siguiente vuelve a correr (una vez por día)", async () => {
    const { state, deps } = memory([mk("a", { plannedOn: TODAY, estimateMin: 30 })]);
    await replanAllWith(deps, "u1", TODAY);
    expect(state.tasks[0].plannedOn).toBe(TODAY); // hoy no está atrasada
    expect((await replanAllWith(deps, "u1", d(1))).ran).toBe(true);
    expect(state.tasks[0].plannedOn).toBe(d(1)); // mañana sí: quedó atrás y se mueve
  });

  it("un día después, lo que quedó atrás se mueve y suma otra postergación", async () => {
    const t = mk("a", { plannedOn: TODAY, dueDate: d(6), estimateMin: 30 });
    const { deps } = memory([t], { replanned: TODAY });
    const report = await replanAllWith(deps, "u1", d(1));
    expect(report.moved[0]).toMatchObject({ from: TODAY, to: d(1) });
    expect(t.postponedCount).toBe(1);
  });

  it("no se mueve lo fijado ni los recordatorios; lo con hora tampoco", async () => {
    const tasks = [
      mk("pin", { plannedOn: d(-2), pinned: true }), mk("rem", { kind: "reminder", dueDate: d(-1) }), mk("hora", { plannedOn: d(-2), time: "09:00" })
    ];
    const { state, deps } = memory(tasks);
    const report = await replanAllWith(deps, "u1", TODAY);
    expect(report.moved).toEqual([]);
    expect(state.tasks.map((t) => t.plannedOn ?? t.dueDate)).toEqual([d(-2), d(-1), d(-2)]);
    expect(state.tasks.every((t) => t.postponedCount === 0)).toBe(true);
  });

  it("lo que ya venció queda en Hoy: no se mueve solo", async () => {
    const t = mk("vencida", { dueDate: d(-1) });
    const { deps } = memory([t]);
    expect((await replanAllWith(deps, "u1", TODAY)).moved).toEqual([]);
    expect(t.plannedOn).toBeUndefined();
  });

  it("respeta la agenda ocupada: no cae en un día tomado por un evento", async () => {
    const { deps } = memory([mk("a", { plannedOn: d(-1) })], { extraLoad: { [TODAY]: 540 } });
    expect((await replanAllWith(deps, "u1", TODAY)).moved[0].to).toBe(d(1));
  });

  it("conflicto: si no entra antes de su fecha límite, no se fuerza y queda marcada; después se limpia", async () => {
    const t = mk("a", { plannedOn: d(-1), dueDate: d(1) });
    const busy = { extraLoad: { [TODAY]: 9999, [d(1)]: 9999 } };
    const { state, deps } = memory([t], busy);
    const report = await replanAllWith(deps, "u1", TODAY);
    expect(report.moved).toEqual([]);
    expect(report.conflicts).toEqual([{ taskId: "a", title: "a", dueDate: d(1), neededMin: 60 }]);
    expect(state.conflicts.has("a")).toBe(true);
    expect(t.plannedOn).toBe(d(-1)); // no se movió

    // el usuario suma minutos (o se libera el día): se vuelve a acomodar y la marca se va
    const freed = memory([t], { extraLoad: {} });
    freed.state.conflicts.add("a");
    await replanAllWith(freed.deps, "u1", TODAY, { force: true });
    expect(freed.state.conflicts.has("a")).toBe(false);
    expect(t.plannedOn).toBe(TODAY);
  });

  it("lo que el usuario acaba de deshacer no se vuelve a mover hoy", async () => {
    const { deps } = memory([mk("a", { plannedOn: d(-1) })], { hold: ["a"] });
    expect((await replanAllWith(deps, "u1", TODAY, { force: true })).moved).toEqual([]);
  });

  it("si dos pedidos corren a la vez, el segundo no duplica el movimiento", async () => {
    const t = mk("a", { plannedOn: d(-1) });
    const { state, deps } = memory([t]);
    const [x, y] = await Promise.all([replanAllWith(deps, "u1", TODAY, { force: true }), replanAllWith(deps, "u1", TODAY, { force: true })]);
    expect(x.moved.length + y.moved.length).toBe(1);
    expect(t.postponedCount).toBe(1);
    expect(state.moves).toHaveLength(1);
  });

  it("usa el 'hoy' del usuario: el mismo instante mueve o no según su zona", async () => {
    const instant = new Date("2026-10-01T01:00:00Z");
    const t = mk("a", { plannedOn: "2026-09-30", dueDate: "2026-10-05" });
    const ba = memory([{ ...t }]);
    expect((await replanAllWith(ba.deps, "u1", getTodayInTimeZone("America/Argentina/Buenos_Aires", instant))).moved).toEqual([]);
    const tokyo = memory([{ ...t }]);
    expect((await replanAllWith(tokyo.deps, "u1", getTodayInTimeZone("Asia/Tokyo", instant))).moved).toHaveLength(1);
  });
});

describe("ocurrencias de series que no se hicieron", () => {
  const series: SeriesRecord = {
    id: "s1", userId: "u1", kind: "task", title: "Gimnasio", category: "x", description: "", priority: "medium",
    estimateMin: 60, time: null, rule: { freq: "daily", interval: 1 }, startsOn: d(-3), endsOn: null, active: true
  };

  function seriesStore() {
    const rows = new Map<string, { date: string; status: "pending" | "done" | "skipped" }>();
    for (const n of [-3, -2, -1]) rows.set(d(n), { date: d(n), status: "pending" });
    const store: OccurrenceStore = {
      listSeriesInWindow: async () => [series],
      insertOccurrences: async (_u, _s, dates) => { let n = 0; for (const date of dates) if (!rows.has(date)) { rows.set(date, { date, status: "pending" }); n += 1; } return n; },
      skipPastPending: async (_u, today) => { let n = 0; for (const r of rows.values()) if (r.date < today && r.status === "pending") { r.status = "skipped"; n += 1; } return n; }
    };
    return { rows, store };
  }

  it("pasan a 'skipped' solas y no se acumulan", async () => {
    const { rows, store } = seriesStore();
    const result = await ensureOccurrencesWith(store, "u1", TODAY);
    expect(result.skipped).toBe(3);
    expect([...rows.values()].filter((r) => r.date < TODAY).every((r) => r.status === "skipped")).toBe(true);
    expect([...rows.values()].filter((r) => r.date >= TODAY).every((r) => r.status === "pending")).toBe(true);
    expect((await ensureOccurrencesWith(store, "u1", TODAY)).skipped).toBe(0); // idempotente
  });

  it("no cortan la racha: sus días son neutros", async () => {
    // Hizo algo el 27, dejó pasar el 28 y el 29 (ocurrencias salteadas), hizo algo hoy.
    const done = new Set([d(-3), TODAY]);
    const skipped = new Set([d(-2), d(-1)]);
    expect(streakFromDayKeys(done, skipped, TODAY, false)).toBe(2);
    expect(bestStreakFromDayKeys([...done], skipped)).toBe(2);
    // sin la marca de salteadas, los días vacíos cortan la racha
    expect(streakFromDayKeys(done, new Set(), TODAY, false)).toBe(1);
    expect(getSkippedDates([{ status: "skipped", occurrenceDate: d(-2) }, { status: "pending", occurrenceDate: d(-1) }] as never)).toEqual([d(-2)]);
  });
});
