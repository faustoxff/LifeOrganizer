import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { busyLoadByDate, type BusyBlock } from "@/lib/busy-blocks";
import { computeFixedLoad } from "@/lib/project-scheduling";
import { daysPastDue, isOverdueFixed, isReplannable, planOverdueTasks, plannedDateOf, type ReplanTask } from "@/lib/task-replan";
import { getTodayInTimeZone } from "@/lib/task-date";

// Miércoles 2026-09-30. Disponibilidad por defecto: lun-vie 2 h, sáb 3 h, dom 1 h.
const TODAY = "2026-09-30";
const d = (n: number) => new Date(Date.UTC(2026, 8, 30 + n)).toISOString().slice(0, 10);

const task = (id: string, over: Partial<ReplanTask> = {}): ReplanTask => ({
  id, title: id, kind: "task", priority: "medium", estimateMin: 60, dueDate: d(7), done: false, status: "pending", ...over
});
const plan = (tasks: ReplanTask[], extra: Record<string, unknown> = {}) =>
  planOverdueTasks({ today: TODAY, tasks, availability: DEFAULT_AVAILABILITY, ...extra });

describe("qué se puede mover", () => {
  it("una tarea suelta pendiente con el día planificado atrasado y la fecha límite por delante", () => {
    expect(isReplannable(task("a", { plannedOn: d(-2) }), TODAY)).toBe(true);
    expect(isReplannable(task("a", { dueDate: d(-1), plannedOn: undefined }), TODAY)).toBe(false); // ya venció
  });

  it("no se mueve lo fijado, lo hecho, lo salteado, los recordatorios, lo que tiene hora, los proyectos ni las series", () => {
    const late = { plannedOn: d(-2) };
    for (const t of [
      task("pin", { ...late, pinned: true }), task("done", { ...late, done: true, status: "done" }), task("skip", { ...late, status: "skipped" }),
      task("rem", { ...late, kind: "reminder" }), task("hora", { ...late, time: "10:00" }), task("proy", { ...late, kind: "project" }),
      task("serie", { ...late, seriesId: "s1" })
    ]) expect(isReplannable(t, TODAY), t.id).toBe(false);
  });

  it("lo que ya está planificado para hoy o después no se toca", () => {
    expect(isReplannable(task("a", { plannedOn: TODAY }), TODAY)).toBe(false);
    expect(isReplannable(task("a", { plannedOn: d(3) }), TODAY)).toBe(false);
  });

  it("plannedDateOf usa la planificada y, sin ella, la fecha límite", () => {
    expect(plannedDateOf({ dueDate: d(5) })).toBe(d(5));
    expect(plannedDateOf({ dueDate: d(5), plannedOn: d(2) })).toBe(d(2));
  });

  it("daysPastDue e isOverdueFixed", () => {
    expect(daysPastDue(task("a", { dueDate: d(-1) }), TODAY)).toBe(1);
    expect(daysPastDue(task("a", { dueDate: TODAY }), TODAY)).toBeNull();
    expect(daysPastDue(task("a", { dueDate: d(-1), kind: "reminder" }), TODAY)).toBeNull();
    expect(isOverdueFixed(task("r", { kind: "reminder", dueDate: d(-1) }), TODAY)).toBe(true);
    expect(isOverdueFixed(task("t", { time: "09:00", dueDate: d(-1) }), TODAY)).toBe(true);
    expect(isOverdueFixed(task("s", { kind: "reminder", dueDate: d(-1), seriesId: "x" }), TODAY)).toBe(false);
    expect(isOverdueFixed(task("h", { kind: "reminder", dueDate: TODAY }), TODAY)).toBe(false);
  });
});

describe("una tarea atrasada se mueve al próximo hueco", () => {
  it("hoy, si hay lugar", () => {
    const r = plan([task("a", { plannedOn: d(-3) })]);
    expect(r.moves).toEqual([{ taskId: "a", title: "a", from: d(-3), to: TODAY }]);
  });

  it("nunca cambia la fecha límite: solo se propone un día, siempre entre hoy y esa fecha", () => {
    const r = plan([task("a", { plannedOn: d(-3), dueDate: d(4) }), task("b", { plannedOn: d(-1), dueDate: d(1), estimateMin: 120 })]);
    for (const move of r.moves) {
      const t = [task("a", { dueDate: d(4) }), task("b", { dueDate: d(1) })].find((x) => x.id === move.taskId)!;
      expect(move.to >= TODAY && move.to <= t.dueDate).toBe(true);
    }
    expect(Object.keys(r.moves[0])).toEqual(["taskId", "title", "from", "to"]);
  });

  it("respeta la disponibilidad: si hoy hay 2 h y ya hay 90 min, va al día siguiente", () => {
    const r = plan([task("hoy", { plannedOn: TODAY, estimateMin: 90 }), task("a", { plannedOn: d(-1), estimateMin: 60 })]);
    expect(r.moves).toEqual([{ taskId: "a", title: "a", from: d(-1), to: d(1) }]);
  });

  it("reparte varias: la de fecha límite más cercana elige primero", () => {
    const r = plan([
      task("lejana", { plannedOn: d(-1), dueDate: d(6), estimateMin: 120 }),
      task("urgente", { plannedOn: d(-1), dueDate: d(1), estimateMin: 120 })
    ]);
    const to = Object.fromEntries(r.moves.map((m) => [m.taskId, m.to]));
    expect(to).toEqual({ urgente: TODAY, lejana: d(1) });
  });

  it("a igual fecha límite, gana la de más prioridad", () => {
    const r = plan([
      task("baja", { plannedOn: d(-1), dueDate: d(2), priority: "low", estimateMin: 120 }),
      task("alta", { plannedOn: d(-1), dueDate: d(2), priority: "high", estimateMin: 120 })
    ]);
    expect(r.moves.find((m) => m.taskId === "alta")!.to).toBe(TODAY);
    expect(r.moves.find((m) => m.taskId === "baja")!.to).toBe(d(1));
  });

  it("un día sin disponibilidad se saltea, y también las sobreescrituras por fecha", () => {
    const availability = { ...DEFAULT_AVAILABILITY, "3": 0 }; // miércoles (hoy) sin tiempo
    expect(plan([task("a", { plannedOn: d(-1) })], { availability }).moves[0].to).toBe(d(1));
    expect(plan([task("a", { plannedOn: d(-1) })], { overrides: { [TODAY]: 0, [d(1)]: 0 } }).moves[0].to).toBe(d(2));
  });

  it("una tarea más larga que cualquier día toma el primer día vacío", () => {
    const r = plan([task("hoy", { plannedOn: TODAY, estimateMin: 30 }), task("enorme", { plannedOn: d(-1), estimateMin: 600 })]);
    expect(r.moves[0].to).toBe(d(1));
  });

  it("lo planificado a futuro no se reordena", () => {
    expect(plan([task("a", { plannedOn: d(2) }), task("b", { plannedOn: TODAY })]).moves).toEqual([]);
  });
});

describe("agenda ocupada", () => {
  const event: BusyBlock = { id: "cal", title: "Casamiento", source: "calendar", importance: "high", prepMin: 60, start: "2026-09-30T15:00:00Z", end: "2026-09-30T23:00:00Z" };
  const busy = busyLoadByDate([event], "America/Argentina/Buenos_Aires"); // hoy: 8 h + 1 h de margen

  it("no cae encima de un evento: el día ocupado no recibe la tarea", () => {
    expect(busy[TODAY]).toBe(540);
    expect(plan([task("a", { plannedOn: d(-1) })], { extraLoad: busy }).moves[0].to).toBe(d(1));
  });

  it("las sesiones de proyecto también cuentan como carga", () => {
    const r = plan([task("a", { plannedOn: d(-1), estimateMin: 60 })], { extraLoad: { [TODAY]: 100, [d(1)]: 90 } });
    expect(r.moves[0].to).toBe(d(2));
  });
});

describe("conflictos", () => {
  it("si no entra antes de su fecha límite, no se fuerza: queda en conflicto y no se mueve", () => {
    const busy = { [TODAY]: 9999, [d(1)]: 9999 };
    const r = plan([task("a", { plannedOn: d(-1), dueDate: d(1), estimateMin: 60 })], { extraLoad: busy });
    expect(r.moves).toEqual([]);
    expect(r.conflicts).toEqual([{ taskId: "a", title: "a", dueDate: d(1), neededMin: 60 }]);
  });

  it("lo que ya venció no se mueve y no es un conflicto: queda 'Venció ayer'", () => {
    const r = plan([task("a", { plannedOn: undefined, dueDate: d(-1) })]);
    expect(r).toEqual({ moves: [], conflicts: [], resolved: [] });
  });

  it("una marca de conflicto se limpia cuando la tarea por fin entra o cuando ya venció", () => {
    const ok = plan([task("a", { plannedOn: d(-1), conflict: true })]);
    expect(ok.resolved).toEqual(["a"]);
    const late = plan([task("b", { dueDate: d(-2), conflict: true })]);
    expect(late.resolved).toEqual(["b"]);
    const still = plan([task("c", { plannedOn: d(-1), dueDate: d(1), conflict: true })], { extraLoad: { [TODAY]: 9999, [d(1)]: 9999 } });
    expect(still.resolved).toEqual([]);
  });
});

describe("idempotencia y casos especiales", () => {
  it("aplicar los movimientos y volver a correr no cambia nada", () => {
    const tasks = [task("a", { plannedOn: d(-2), estimateMin: 90 }), task("b", { plannedOn: d(-1), estimateMin: 90 }), task("c", { plannedOn: d(-3), estimateMin: 30 })];
    const first = plan(tasks);
    expect(first.moves).toHaveLength(3);
    const applied = tasks.map((t) => ({ ...t, plannedOn: first.moves.find((m) => m.taskId === t.id)?.to ?? t.plannedOn }));
    expect(plan(applied)).toEqual({ moves: [], conflicts: [], resolved: [] });
  });

  it("es determinística", () => {
    const tasks = [task("b", { plannedOn: d(-1) }), task("a", { plannedOn: d(-1) })];
    expect(plan(tasks)).toEqual(plan([...tasks].reverse()));
  });

  it("lo que se acaba de deshacer (hold) no se vuelve a mover hoy", () => {
    const r = plan([task("a", { plannedOn: d(-1) })], { hold: new Set(["a"]) });
    expect(r.moves).toEqual([]);
  });

  it("los recordatorios y lo fijado siguen ocupando su lugar, aunque no se muevan", () => {
    const r = plan([
      task("fijada", { plannedOn: TODAY, pinned: true, estimateMin: 90 }),
      task("rec", { kind: "reminder", dueDate: TODAY, estimateMin: 30 }),
      task("a", { plannedOn: d(-1), estimateMin: 30 })
    ]);
    expect(r.moves[0].to).toBe(d(1)); // hoy ya hay 120 min ocupados de 120
  });

  it("usa el 'hoy' del usuario: el mismo instante es un día distinto en Buenos Aires y en Tokio", () => {
    const instant = new Date("2026-10-01T01:00:00Z");
    const ba = getTodayInTimeZone("America/Argentina/Buenos_Aires", instant); // 2026-09-30
    const tokyo = getTodayInTimeZone("Asia/Tokyo", instant); // 2026-10-01
    const t = task("a", { plannedOn: "2026-09-30", dueDate: "2026-10-05" });
    expect(planOverdueTasks({ today: ba, tasks: [t], availability: DEFAULT_AVAILABILITY }).moves).toEqual([]); // hoy es hoy, no está atrasada
    expect(planOverdueTasks({ today: tokyo, tasks: [t], availability: DEFAULT_AVAILABILITY }).moves[0]).toMatchObject({ from: "2026-09-30", to: "2026-10-01" });
  });
});

describe("la carga de cada día usa la fecha planificada, no la fecha límite", () => {
  it("computeFixedLoad", () => {
    const tasks = [
      { id: "a", title: "a", kind: "task", priority: "medium", estimateMin: 60, dueDate: d(7), plannedOn: d(1), done: false, status: "pending", category: "x", description: "" },
      { id: "b", title: "b", kind: "task", priority: "medium", estimateMin: 30, dueDate: d(2), done: false, status: "pending", category: "x", description: "" }
    ] as never;
    expect(computeFixedLoad(tasks, TODAY)).toEqual({ [d(1)]: 60, [d(2)]: 30 });
  });
});
