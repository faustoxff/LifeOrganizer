import { describe, expect, it } from "vitest";
import { getFreeWindow, type BusyBlock } from "@/lib/busy-blocks";
import {
  getRecommendations,
  getRecommendedTask,
  isChoiceValid,
  MANUAL_MAX_AGE_MIN,
  MORE_MIN,
  withAvailableMinutes,
  type IdleRecommendation,
  type Recommendation,
  type TaskRecommendation
} from "@/lib/recommendation";
import { blockKeyOf } from "@/lib/busy-blocks";
import { computePatterns, type HistoryEntry } from "@/lib/user-patterns";
import type { Task } from "@/types/task";

const BA = "America/Argentina/Buenos_Aires";
// 2026-09-30 10:00 en Buenos Aires
const NOW = new Date("2026-09-30T13:00:00Z");
const TODAY = "2026-09-30";
const plusDays = (n: number) => new Date(Date.UTC(2026, 8, 30 + n)).toISOString().slice(0, 10);

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, category: "general", description: "", priority: "medium", estimateMin: 30,
  dueDate: plusDays(10), done: false, status: "pending", kind: "task", ...over
});
const block = (over: Partial<BusyBlock> & { start: string; end: string }): BusyBlock => ({
  id: "b1", title: "Cumpleaños", source: "reminder", importance: "normal", prepMin: 0, ...over
});
/** Un bloque que empieza dentro de `min` minutos. */
const blockIn = (min: number, over: Partial<BusyBlock> = {}) =>
  block({
    start: new Date(NOW.getTime() + min * 60_000).toISOString(),
    end: new Date(NOW.getTime() + (min + 60) * 60_000).toISOString(),
    ...over
  });

const windowFor = (blocks: BusyBlock[] = [], dayCapacityMin = 600) => getFreeWindow({ now: NOW, blocks, timeZone: BA, dayCapacityMin });
const recs = (tasks: Task[], blocks: BusyBlock[] = [], extra: Record<string, unknown> = {}) =>
  getRecommendations(tasks, { now: NOW, timeZone: BA, window: windowFor(blocks), ...extra });
const first = (tasks: Task[], blocks: BusyBlock[] = [], extra: Record<string, unknown> = {}) =>
  recs(tasks, blocks, extra)[0];
const asTask = (r: Recommendation) => { expect(r.type).toBe("task"); return r as TaskRecommendation; };
const asIdle = (r: Recommendation) => { expect(["rest", "prepare"]).toContain(r.type); return r as IdleRecommendation; };

describe("con poco tiempo", () => {
  it("solo recomienda lo que entra en la ventana", () => {
    const r = asTask(first([task("larga", { estimateMin: 90, priority: "high" }), task("corta", { estimateMin: 15 })], [blockIn(20)]));
    expect(r.task.id).toBe("corta");
    expect(r).toMatchObject({ mode: "finish", minutes: 15 });
    expect(r.reason.freeMin).toBe(20);
  });

  it("entre las que entran, gana la de mayor puntaje", () => {
    const r = asTask(first([task("media", { estimateMin: 15 }), task("alta", { estimateMin: 15, priority: "high" })], [blockIn(30)]));
    expect(r.task.id).toBe("alta");
  });

  it("con factor aprendido, la categoría medida entra o no según su propio factor", () => {
    const patterns = computePatterns([
      ...Array.from({ length: 6 }, () => ({ title: "t", category: "estudio", estimateMin: 30, actualMin: 45, completed: true, completedHour: 9, postponedCount: 0 })),
      ...Array.from({ length: 6 }, () => ({ title: "t", category: "casa", estimateMin: 30, actualMin: 30, completed: true, completedHour: 9, postponedCount: 0 }))
    ]);
    const r = recs([task("estudiar", { category: "estudio" }), task("ordenar", { category: "casa" })], [blockIn(40)], { patterns });
    expect(r.filter((x) => x.type === "task").map((x) => (x as TaskRecommendation).task.id)).toEqual(["ordenar"]);
    expect((r[0] as TaskRecommendation).needMin).toBe(30);
  });
});

describe("rest vs prepare", () => {
  const long = [task("larga", { estimateMin: 120 })];

  it("nada entra y el próximo bloque es de calendario: prepare", () => {
    const r = asIdle(first(long, [blockIn(25, { id: "cal", source: "calendar", title: "Cumpleaños" })]));
    expect(r.type).toBe("prepare");
    expect(r.reason).toMatchObject({ code: "NOTHING_FITS", freeMin: 25 });
    expect(r.reason.block?.title).toBe("Cumpleaños");
  });

  it("nada entra y el bloque es de importancia alta: prepare", () => {
    expect(asIdle(first(long, [blockIn(25, { importance: "high" })])).type).toBe("prepare");
  });

  it("nada entra y el bloque es común: rest", () => {
    expect(asIdle(first(long, [blockIn(25)])).type).toBe("rest");
  });

  it("nada entra y no hay bloque: rest", () => {
    expect(asIdle(first([task("enorme", { estimateMin: 2000 })], [], { window: windowFor([], 30) })).type).toBe("rest");
  });

  it("sin tareas pendientes: NO_TASKS", () => {
    expect(asIdle(first([])).reason.code).toBe("NO_TASKS");
    expect(asIdle(first([task("hecha", { done: true, status: "done" })])).reason.code).toBe("NO_TASKS");
  });

  it("lo único que entra es de prioridad baja y sin vencimiento cercano: rest", () => {
    const r = asIdle(first([task("baja", { estimateMin: 10, priority: "low", dueDate: plusDays(20) })], [blockIn(30)]));
    expect(r).toMatchObject({ type: "rest", reason: { code: "ONLY_LOW" } });
  });

  it("una de prioridad baja con vencimiento cercano sí se recomienda", () => {
    expect(asTask(first([task("baja", { estimateMin: 10, priority: "low", dueDate: plusDays(2) })], [blockIn(30)])).task.id).toBe("baja");
  });

  it("en el margen del bloque (0 min libres) o dentro de un evento, no hay tarea", () => {
    const prep = asIdle(first([task("corta", { estimateMin: 5 })], [blockIn(10, { source: "calendar", prepMin: 15 })]));
    expect(prep).toMatchObject({ type: "prepare", reason: { code: "PREP_WINDOW", freeMin: 0 } });
    const inside = asIdle(first([task("corta", { estimateMin: 5 })], [block({ id: "now", start: new Date(NOW.getTime() - 600_000).toISOString(), end: new Date(NOW.getTime() + 600_000).toISOString() })]));
    expect(inside).toMatchObject({ type: "rest", reason: { code: "IN_BLOCK" } });
  });
});

describe("la excepción de lo que vence hoy", () => {
  it("lo que vence hoy y entra se recomienda aunque haya un evento cerca", () => {
    const r = asTask(first([task("hoy", { estimateMin: 20, dueDate: TODAY, priority: "low" }), task("otra", { estimateMin: 10 })], [blockIn(30, { source: "calendar", importance: "high" })]));
    expect(r.task.id).toBe("hoy");
    expect(r.reason.code).toBe("DUE_TODAY");
  });

  it("si lo que vence hoy NO entra, no se fuerza: se descansa o prepara", () => {
    const r = first([task("hoy", { estimateMin: 90, dueDate: TODAY })], [blockIn(30, { source: "calendar" })]);
    expect(r.type).toBe("prepare");
  });

  it("lo vencido es OVERDUE", () => {
    expect(asTask(first([task("viejo", { estimateMin: 10, dueDate: plusDays(-3) })])).reason.code).toBe("OVERDUE");
  });
});

describe("tareas largas: avanzar", () => {
  it("una tarea de proyecto que no entra se propone para avanzar en el bloque útil", () => {
    const r = asTask(first([task("sesion", { kind: "project", estimateMin: 90 })], [blockIn(40)]));
    expect(r).toMatchObject({ mode: "advance", minutes: 40, needMin: 90 });
  });

  it("los minutos de avanzar son múltiplo de 5 y nunca más de lo libre", () => {
    expect(asTask(first([task("sesion", { kind: "project", estimateMin: 90 })], [blockIn(43)])).minutes).toBe(40);
  });

  it("una tarea con pasos también se puede avanzar", () => {
    const steps = [{ id: "1", text: "a", done: false }];
    expect(asTask(first([task("conPasos", { estimateMin: 120, steps })], [blockIn(30)])).mode).toBe("advance");
  });

  it("una tarea larga sin pasos y que no es de proyecto no se puede avanzar", () => {
    expect(first([task("sinPasos", { estimateMin: 120 })], [blockIn(30)]).type).not.toBe("task");
  });

  it("con menos de 25 minutos no vale la pena avanzar", () => {
    expect(first([task("sesion", { kind: "project", estimateMin: 90 })], [blockIn(20)]).type).not.toBe("task");
    expect(asTask(first([task("sesion", { kind: "project", estimateMin: 90 })], [blockIn(25)])).minutes).toBe(25);
  });

  it("si la tarea entera entra, se propone terminarla, no avanzarla", () => {
    expect(asTask(first([task("sesion", { kind: "project", estimateMin: 30 })], [blockIn(60)])).mode).toBe("finish");
  });
});

describe("cansado", () => {
  it("prefiere lo corto y liviano", () => {
    const tasks = [task("larga", { estimateMin: 60, priority: "high", dueDate: plusDays(1) }), task("corta", { estimateMin: 15, priority: "medium" })];
    expect(asTask(first(tasks)).task.id).toBe("larga");
    expect(asTask(first(tasks, [], { energy: "tired" })).task.id).toBe("corta");
    expect(asTask(first(tasks, [], { energy: "tired" })).reason.code).toBe("TIRED_LIGHT");
  });

  it("lo largo que vence hoy sigue entrando aunque esté cansado", () => {
    const r = recs([task("larga", { estimateMin: 60, dueDate: TODAY })], [], { energy: "tired" });
    expect(asTask(r[0]).task.id).toBe("larga");
  });

  it("no propone avanzar algo largo si está cansado (salvo que venza hoy)", () => {
    expect(first([task("sesion", { kind: "project", estimateMin: 90 })], [blockIn(40)], { energy: "tired" }).type).not.toBe("task");
  });
});

describe("horario en el que rinde más", () => {
  const morning = (n: number): HistoryEntry[] => Array.from({ length: n }, () => ({ title: "t", category: "x", estimateMin: null, actualMin: null, completed: true, completedHour: 9, postponedCount: 0 }));
  const patterns = computePatterns(morning(20)); // rinde a la mañana; NOW es 10:00 local
  // Misma urgencia (lejos) y el mismo puntaje (11): sin bonus desempata el título; con bonus gana la pesada.
  const heavy = task("pesada", { estimateMin: 60, priority: "high", dueDate: plusDays(10) });
  const light = task("liviana", { estimateMin: 30, priority: "high", dueDate: plusDays(10) });

  it("suma un bonus chico a lo pesado en su franja", () => {
    const without = recs([heavy, light]).map((r) => (r as TaskRecommendation).task.id);
    const withBonus = recs([heavy, light], [], { patterns }).map((r) => (r as TaskRecommendation).task.id);
    expect(withBonus[0]).toBe("pesada");
    expect(without[0]).toBe("liviana");
  });

  it("fuera de esa franja no cambia nada", () => {
    const evening = { now: new Date("2026-09-30T23:00:00Z"), timeZone: BA }; // 20:00 local
    const list = getRecommendations([heavy, light], { ...evening, window: getFreeWindow({ now: evening.now, blocks: [], timeZone: BA, dayCapacityMin: 600 }), patterns });
    expect((list[0] as TaskRecommendation).task.id).toBe("liviana");
  });

  it("nunca pasa por encima de una fecha límite más cercana", () => {
    const dueTomorrow = task("vence-mañana", { estimateMin: 30, priority: "low", dueDate: plusDays(1) });
    const list = recs([heavy, dueTomorrow], [], { patterns });
    expect((list[0] as TaskRecommendation).task.id).toBe("vence-mañana");
  });

  it("sin horario aprendido (pocas tareas) no hay bonus", () => {
    const list = recs([heavy, light], [], { patterns: computePatterns(morning(3)) });
    expect((list[0] as TaskRecommendation).task.id).toBe("liviana");
  });
});

describe("las opciones y la razón", () => {
  it("devuelve todas las que sirven, ordenadas, para el botón 'Otra'", () => {
    const list = recs([task("a", { priority: "high" }), task("b"), task("c", { priority: "low", dueDate: plusDays(1) })]);
    // 'c' vence mañana, así que pesa más que las que vencen lejos; después 'a' (alta) y 'b'.
    expect(list.map((r) => (r as TaskRecommendation).task.id)).toEqual(["c", "a", "b"]);
  });

  it("los recordatorios, lo hecho, lo salteado y las ocurrencias futuras no compiten", () => {
    const list = recs([
      task("rec", { kind: "reminder" }), task("hecha", { done: true, status: "done" }), task("salteada", { status: "skipped" }),
      task("futura", { seriesId: "s", occurrenceDate: plusDays(3), dueDate: plusDays(3) })
    ]);
    expect(asIdle(list[0]).reason.code).toBe("NO_TASKS");
  });

  it("siempre trae una razón con el tiempo libre", () => {
    for (const r of recs([task("a")], [blockIn(45)])) expect(r.reason.freeMin).toBe(45);
    expect(getRecommendedTask([task("a")], { now: NOW, timeZone: BA, window: windowFor() })).toEqual(recs([task("a")])[0]);
  });

  it("es determinística: mismos datos, misma respuesta", () => {
    const tasks = [task("a"), task("b"), task("c")];
    expect(JSON.stringify(recs(tasks))).toBe(JSON.stringify(recs(tasks)));
  });
});

describe("zona horaria del usuario", () => {
  it("'hoy' es el del usuario: a las 22:00 en Buenos Aires (01:00Z del 1/10) lo del 30/9 vence hoy, no está vencido", () => {
    const now = new Date("2026-10-01T01:00:00Z");
    const window = getFreeWindow({ now, blocks: [], timeZone: BA, dayCapacityMin: 600 });
    const r = asTask(getRecommendedTask([task("hoy", { estimateMin: 20, dueDate: "2026-09-30" })], { now, timeZone: BA, window }));
    expect(r.reason.code).toBe("DUE_TODAY");
    // En UTC ya sería el 1/10 y la misma tarea estaría vencida.
    const utcWindow = getFreeWindow({ now, blocks: [], timeZone: "UTC", dayCapacityMin: 600 });
    expect(asTask(getRecommendedTask([task("hoy", { estimateMin: 20, dueDate: "2026-09-30" })], { now, timeZone: "UTC", window: utcWindow })).reason.code).toBe("OVERDUE");
  });

  it("la franja de 'rinde más' se lee en la hora local", () => {
    const patterns = computePatterns(Array.from({ length: 20 }, () => ({ title: "t", category: "x", estimateMin: null, actualMin: null, completed: true, completedHour: 9, postponedCount: 0 })));
    const heavy = task("pesada", { estimateMin: 60, priority: "high", dueDate: plusDays(10) });
    const light = task("liviana", { estimateMin: 30, priority: "high", dueDate: plusDays(10) });
    // 13:00Z = 10:00 en Buenos Aires (mañana) pero 22:00 en Tokio (noche).
    const at = (tz: string) => getRecommendations([heavy, light], { now: NOW, timeZone: tz, window: getFreeWindow({ now: NOW, blocks: [], timeZone: tz, dayCapacityMin: 600 }), patterns })[0] as TaskRecommendation;
    expect(at(BA).task.id).toBe("pesada");
    expect(at("Asia/Tokyo").task.id).toBe("liviana");
  });
});

describe("chips manuales", () => {
  it("'tengo X min' reemplaza la ventana calculada", () => {
    const w = windowFor([], 600); // 14 h libres
    expect(withAvailableMinutes(w, 30)).toMatchObject({ freeMin: 30, limit: "manual" });
    expect(withAvailableMinutes(w, 15).freeMin).toBe(15);
    expect(withAvailableMinutes(w, 60).freeMin).toBe(60);
  });

  it("no pasa por encima del próximo bloque real: si hay un evento en 40 min, 'Más' son 40", () => {
    const w = windowFor([blockIn(40, { id: "cal", source: "calendar" })]);
    expect(withAvailableMinutes(w, 60).freeMin).toBe(40);
    expect(withAvailableMinutes(w, MORE_MIN).freeMin).toBe(40);
    expect(withAvailableMinutes(w, 15).freeMin).toBe(15);
  });

  it("puede dar más que la disponibilidad del día (la corrige), pero no pasa de medianoche", () => {
    expect(withAvailableMinutes(windowFor([], 30), MORE_MIN).freeMin).toBe(MORE_MIN);
    const late = getFreeWindow({ now: new Date("2026-10-01T02:30:00Z"), blocks: [], timeZone: BA, dayCapacityMin: 30 });
    expect(withAvailableMinutes(late, MORE_MIN).freeMin).toBe(30);
  });

  it("cambia la recomendación: con 15 min entra otra cosa que con 60", () => {
    const tasks = [task("larga", { estimateMin: 45, priority: "high" }), task("corta", { estimateMin: 10 })];
    const at = (min: number) => asTask(getRecommendations(tasks, { now: NOW, timeZone: BA, window: withAvailableMinutes(windowFor(), min) })[0]).task.id;
    expect(at(15)).toBe("corta");
    expect(at(60)).toBe("larga");
  });

  it("la elección vale 60 minutos y mientras no cambie el próximo bloque", () => {
    const w = windowFor([blockIn(90, { id: "cal" })]);
    const choice = { setAt: NOW.getTime(), blockKey: blockKeyOf(w) };
    expect(isChoiceValid(choice, w, NOW)).toBe(true);
    expect(isChoiceValid(choice, w, new Date(NOW.getTime() + (MANUAL_MAX_AGE_MIN - 1) * 60_000))).toBe(true);
    expect(isChoiceValid(choice, w, new Date(NOW.getTime() + MANUAL_MAX_AGE_MIN * 60_000))).toBe(false);
    // cambió el próximo bloque
    expect(isChoiceValid(choice, windowFor([blockIn(90, { id: "otro" })]), NOW)).toBe(false);
    expect(isChoiceValid(choice, windowFor([]), NOW)).toBe(false);
    expect(isChoiceValid(null, w, NOW)).toBe(false);
  });
});
