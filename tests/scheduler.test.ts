import { describe, expect, it } from "vitest";
import { capacityOn, DEFAULT_AVAILABILITY } from "@/lib/availability";
import { learnInflation } from "@/lib/estimate-learning";
import { addDays, daysBetween } from "@/lib/recurrence";
import {
  effectiveMinutes,
  replan,
  findDependencyCycle,
  schedule,
  SchedulerCycleError,
  SchedulerError,
  targetDate,
  type ScheduleInput,
  type SchedulerProject,
  type SchedulerSubtask,
  type Session
} from "@/lib/scheduler";

// 2026-09-28 es lunes. Disponibilidad por defecto: lun-vie 120, sáb 180, dom 60.
const TODAY = "2026-09-28";
const MON = "2026-09-28", TUE = "2026-09-29", WED = "2026-09-30", THU = "2026-10-01";
const NO_INFLATION = { inflation: 1 };

const sub = (id: string, estimateMin: number, over: Partial<SchedulerSubtask> = {}): SchedulerSubtask => ({
  id, estimateMin, dependsOn: [], done: false, ...over
});
const project = (id: string, deadline: string, subtasks: SchedulerSubtask[], over: Partial<SchedulerProject> = {}): SchedulerProject => ({
  id, deadline, subtasks, ...over
});
const input = (projects: SchedulerProject[], over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  today: TODAY,
  availability: DEFAULT_AVAILABILITY,
  projects,
  params: NO_INFLATION,
  ...over
});
const minutesOn = (sessions: Session[], date: string) =>
  sessions.filter((s) => s.date === date).reduce((sum, s) => sum + s.minutes, 0);
const of = (sessions: Session[], subtaskId: string) => sessions.filter((s) => s.subtaskId === subtaskId);
const dates = (sessions: Session[], subtaskId: string) => of(sessions, subtaskId).map((s) => s.date);

describe("findDependencyCycle", () => {
  it("encuentra un ciclo y devuelve null si no hay", () => {
    expect(findDependencyCycle([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: [] }])).toBeNull();
    expect(findDependencyCycle([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

describe("helpers", () => {
  it("la duración efectiva es ceil(estimado * inflación), sin errores de coma flotante", () => {
    expect(effectiveMinutes(100, 1.3)).toBe(130); // 100 * 1.3 = 130.00000000000003
    expect(effectiveMinutes(60, 1.3)).toBe(78);
    expect(effectiveMinutes(45, 1.3)).toBe(59); // 58.5
    expect(effectiveMinutes(10, 1)).toBe(10);
  });

  it("la fecha objetivo es today + floor(días * 0.85), y nunca después de deadline - 1", () => {
    expect(targetDate(TODAY, addDays(TODAY, 20), 0.85)).toBe(addDays(TODAY, 17));
    expect(targetDate(TODAY, addDays(TODAY, 10), 0.85)).toBe(addDays(TODAY, 8));
    expect(targetDate(TODAY, addDays(TODAY, 3), 0.85)).toBe(addDays(TODAY, 2)); // floor(2.55) = 2 = deadline - 1
    expect(targetDate(TODAY, addDays(TODAY, 2), 0.85)).toBe(addDays(TODAY, 1)); // floor(1.7)
    expect(targetDate(TODAY, addDays(TODAY, 100), 1)).toBe(addDays(TODAY, 99)); // tope deadline - 1
  });

  it("con el deadline hoy, mañana o vencido el objetivo es hoy", () => {
    expect(targetDate(TODAY, TODAY, 0.85)).toBe(TODAY);
    expect(targetDate(TODAY, TUE, 0.85)).toBe(TODAY);
    expect(targetDate(TODAY, "2026-09-20", 0.85)).toBe(TODAY);
  });
});

describe("plan simple que entra", () => {
  const out = schedule(input([project("p", "2026-10-12", [sub("a", 60), sub("b", 60), sub("c", 60)])]));

  it("agenda todo, es factible y no usa más que el margen", () => {
    expect(out.perProject.p.feasible).toBe(true);
    expect(out.perProject.p.shortfallMin).toBe(0);
    expect(out.sessions.reduce((sum, s) => sum + s.minutes, 0)).toBe(180);
    expect(out.warnings).toEqual([]);
  });

  it("empieza hoy y llena la capacidad del día antes de pasar al siguiente", () => {
    expect(minutesOn(out.sessions, MON)).toBe(120);
    expect(minutesOn(out.sessions, TUE)).toBe(60);
    expect(out.perProject.p.plannedEndDate).toBe(TUE);
    expect(out.perProject.p.bufferDays).toBe(13);
    expect(out.perProject.p.bufferConsumedPct).toBe(0);
  });

  it("una subtarea entera es una sola sesión 1/1", () => {
    for (const s of out.sessions) expect([s.part, s.totalParts]).toEqual([1, 1]);
  });

  it("las sesiones salen ordenadas por fecha", () => {
    const sorted = [...out.sessions].map((s) => s.date).sort();
    expect(out.sessions.map((s) => s.date)).toEqual(sorted);
  });
});

describe("dependencias", () => {
  it("en cadena: cada una empieza el día después de que termina la anterior", () => {
    const out = schedule(input([
      project("p", "2026-10-12", [sub("a", 60), sub("b", 60, { dependsOn: ["a"] }), sub("c", 60, { dependsOn: ["b"] })])
    ]));
    expect(dates(out.sessions, "a")).toEqual([MON]);
    expect(dates(out.sessions, "b")).toEqual([TUE]);
    expect(dates(out.sessions, "c")).toEqual([WED]);
  });

  it("en paralelo: las independientes comparten día y la que depende de ambas espera a las dos", () => {
    const out = schedule(input([
      project("p", "2026-10-12", [sub("a", 60), sub("b", 60), sub("c", 60, { dependsOn: ["a", "b"] })])
    ]));
    expect(dates(out.sessions, "a")).toEqual([MON]);
    expect(dates(out.sessions, "b")).toEqual([MON]);
    expect(dates(out.sessions, "c")).toEqual([TUE]);
  });

  it("una dependencia partida en sesiones bloquea al sucesor hasta su última sesión", () => {
    const out = schedule(input([
      project("p", "2026-10-12", [sub("a", 200), sub("b", 30, { dependsOn: ["a"] })])
    ]));
    const lastA = dates(out.sessions, "a").at(-1) as string;
    expect(dates(out.sessions, "b")[0] > lastA).toBe(true);
  });

  it("una dependencia ya hecha no bloquea", () => {
    const out = schedule(input([
      project("p", "2026-10-12", [sub("a", 60, { done: true }), sub("b", 60, { dependsOn: ["a"] })])
    ]));
    expect(dates(out.sessions, "b")).toEqual([MON]);
    expect(of(out.sessions, "a")).toEqual([]);
  });

  it("un ciclo lanza un error explícito con el camino", () => {
    const cyclic = input([
      project("p", "2026-10-12", [sub("a", 30, { dependsOn: ["c"] }), sub("b", 30, { dependsOn: ["a"] }), sub("c", 30, { dependsOn: ["b"] })])
    ]);
    let caught: unknown;
    try { schedule(cyclic); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SchedulerCycleError);
    expect((caught as SchedulerCycleError).code).toBe("CYCLE");
    expect((caught as SchedulerCycleError).cycle).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect((caught as Error).message).toContain("Circular dependency");
  });

  it("una subtarea que depende de sí misma también es un ciclo", () => {
    expect(() => schedule(input([project("p", "2026-10-12", [sub("a", 30, { dependsOn: ["a"] })])])))
      .toThrow(SchedulerCycleError);
  });

  it("replan también rechaza los ciclos", () => {
    expect(() => replan(input([project("p", "2026-10-12", [sub("a", 30, { dependsOn: ["a"] })])])))
      .toThrow(SchedulerCycleError);
  });

  it("una dependencia inexistente, un id repetido o un dato inválido también son errores explícitos", () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as SchedulerError).code; } return null; };
    expect(code(() => schedule(input([project("p", "2026-10-12", [sub("a", 30, { dependsOn: ["zzz"] })])])))).toBe("UNKNOWN_DEPENDENCY");
    expect(code(() => schedule(input([project("p", "2026-10-12", [sub("a", 30), sub("a", 30)])])))).toBe("DUPLICATE_ID");
    expect(code(() => schedule(input([project("p", "2026-10-12", [sub("a", 0)])])))).toBe("INVALID_INPUT");
    expect(code(() => schedule(input([project("p", "2026-02-31", [sub("a", 30)])])))).toBe("INVALID_INPUT");
    expect(code(() => schedule({ ...input([]), today: "hoy" }))).toBe("INVALID_INPUT");
  });
});

describe("subtareas largas", () => {
  it("una de 4 h (con inflación 1.3) se parte en sesiones de a lo sumo 90 min, en días distintos", () => {
    const out = schedule(input([project("p", "2026-10-30", [sub("big", 240)])], { params: {} }));
    const sessions = of(out.sessions, "big");
    expect(sessions.reduce((sum, s) => sum + s.minutes, 0)).toBe(312); // ceil(240 * 1.3)
    expect(sessions.map((s) => s.minutes)).toEqual([90, 90, 90, 42]);
    expect(new Set(sessions.map((s) => s.date)).size).toBe(sessions.length);
    expect(sessions.map((s) => [s.part, s.totalParts])).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(dates(out.sessions, "big")).toEqual([MON, TUE, WED, THU]);
  });

  it("ninguna sesión queda bajo el mínimo salvo la última: el resto se rebalancea", () => {
    // 100 min con máximo 90: 90 + 10 dejaría una sesión de 10; queda 80 + 20.
    const out = schedule(input([project("p", "2026-10-30", [sub("x", 100)])]));
    expect(of(out.sessions, "x").map((s) => s.minutes)).toEqual([80, 20]);
  });

  it("una subtarea corta (menor al mínimo) va entera", () => {
    const out = schedule(input([project("p", "2026-10-30", [sub("x", 10)])]));
    expect(of(out.sessions, "x").map((s) => s.minutes)).toEqual([10]);
  });

  it("no parte una subtarea en un pedazo menor al mínimo para aprovechar un hueco", () => {
    // Hoy solo quedan 15 min: no se le arranca un pedazo de 15 a una tarea de 60.
    const out = schedule(input([project("p", "2026-10-30", [sub("x", 60)])], { fixedLoad: { [MON]: 105 } }));
    expect(of(out.sessions, "x").map((s) => [s.date, s.minutes])).toEqual([[TUE, 60]]);
  });

  it("aprovecha un hueco si el pedazo llega al mínimo", () => {
    const out = schedule(input([project("p", "2026-10-30", [sub("x", 60)])], { fixedLoad: { [MON]: 90 } }));
    expect(of(out.sessions, "x").map((s) => [s.date, s.minutes])).toEqual([[MON, 30], [TUE, 30]]);
  });

  it("respeta minSessionMin y maxSessionMin configurados", () => {
    const out = schedule(input([project("p", "2026-10-30", [sub("x", 100)])], { params: { inflation: 1, maxSessionMin: 40, minSessionMin: 15 } }));
    const sessions = of(out.sessions, "x");
    expect(sessions.every((s) => s.minutes <= 40)).toBe(true);
    expect(sessions.slice(0, -1).every((s) => s.minutes >= 15)).toBe(true);
    expect(sessions.reduce((sum, s) => sum + s.minutes, 0)).toBe(100);
  });
});

describe("capacidad del día", () => {
  it("un día con override 0 no recibe nada", () => {
    const out = schedule(input(
      [project("p", "2026-10-12", [sub("a", 120), sub("b", 120), sub("c", 120)])],
      { overrides: { [TUE]: 0 } }
    ));
    expect(minutesOn(out.sessions, TUE)).toBe(0);
    expect(minutesOn(out.sessions, MON)).toBe(120);
    expect(minutesOn(out.sessions, WED)).toBe(120);
  });

  it("un override mayor amplía el día: reemplaza, no suma", () => {
    const out = schedule(input(
      [project("p", "2026-10-12", [sub("a", 90), sub("b", 90), sub("c", 90)])],
      { overrides: { [MON]: 300 } }
    ));
    expect(minutesOn(out.sessions, MON)).toBe(270);
  });

  it("una carga fija que llena el día lo deja sin sesiones", () => {
    const out = schedule(input(
      [project("p", "2026-10-12", [sub("a", 60), sub("b", 60)])],
      { fixedLoad: { [MON]: 120 } }
    ));
    expect(minutesOn(out.sessions, MON)).toBe(0);
    expect(minutesOn(out.sessions, TUE)).toBe(120);
  });

  it("una carga fija parcial descuenta de la capacidad", () => {
    const out = schedule(input(
      [project("p", "2026-10-12", [sub("a", 60), sub("b", 60)])],
      { fixedLoad: { [MON]: 80 } }
    ));
    expect(minutesOn(out.sessions, MON)).toBeLessThanOrEqual(40);
  });

  it("nunca agenda en días pasados, y hoy solo con lo que queda", () => {
    const out = schedule(input([project("p", "2026-10-12", [sub("a", 100), sub("b", 100)])], { fixedLoad: { [MON]: 100 } }));
    expect(out.sessions.every((s) => s.date >= TODAY)).toBe(true);
    expect(minutesOn(out.sessions, MON)).toBeLessThanOrEqual(20);
  });

  it("un día con más carga fija que disponibilidad avisa OVERLOADED_DAY", () => {
    const out = schedule(input(
      [project("p", "2026-10-12", [sub("a", 30)])],
      { fixedLoad: { [TUE]: 200 } }
    ));
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: "OVERLOADED_DAY", date: TUE }));
    expect(minutesOn(out.sessions, TUE)).toBe(0);
  });

  it("dailyCapMin limita lo que un proyecto usa por día", () => {
    const out = schedule(input([project("p", "2026-10-30", [sub("a", 60), sub("b", 60)], { dailyCapMin: 30 })]));
    for (const date of new Set(out.sessions.map((s) => s.date))) {
      expect(minutesOn(out.sessions, date)).toBeLessThanOrEqual(30);
    }
    expect(out.sessions.reduce((sum, s) => sum + s.minutes, 0)).toBe(120);
  });

  it("el tope de un proyecto deja lugar para el otro", () => {
    const out = schedule(input([
      project("capped", "2026-10-30", [sub("a", 120)], { dailyCapMin: 30 }),
      project("free", "2026-10-30", [sub("b", 120)])
    ]));
    expect(out.sessions.filter((s) => s.projectId === "capped" && s.date === MON).reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(30);
    expect(minutesOn(out.sessions, MON)).toBe(120);
  });
});

describe("dos proyectos compitiendo", () => {
  it("va primero el de menor holgura (deadline más cercano)", () => {
    const out = schedule(input([
      project("lejos", "2026-10-30", [sub("l", 90)]),
      project("cerca", "2026-10-02", [sub("c", 90)])
    ]));
    // Con 120 disponibles el urgente se lleva su sesión completa (90) y al otro
    // le toca lo que sobra hoy (30); el resto de ese va mañana.
    expect(of(out.sessions, "c").map((s) => [s.date, s.minutes])).toEqual([[MON, 90]]);
    expect(of(out.sessions, "l").map((s) => [s.date, s.minutes])).toEqual([[MON, 30], [TUE, 60]]);
  });

  it("la holgura pesa más que el orden en que llegan los proyectos", () => {
    const a = input([
      project("lejos", "2026-10-30", [sub("l", 90)]),
      project("cerca", "2026-10-02", [sub("c", 90)])
    ]);
    const b = { ...a, projects: [...a.projects].reverse() };
    const urgentFirst = (o: ReturnType<typeof schedule>) => of(o.sessions, "c").map((s) => [s.date, s.minutes]);
    expect(urgentFirst(schedule(a))).toEqual([[MON, 90]]);
    expect(urgentFirst(schedule(b))).toEqual([[MON, 90]]);
  });

  it("dentro de un proyecto, la subtarea más larga de la cadena crítica va antes", () => {
    const out = schedule(input([
      project("p", "2026-10-04", [
        sub("corta", 30),
        sub("larga", 90),
        sub("cola", 60, { dependsOn: ["larga"] })
      ])
    ]));
    expect(dates(out.sessions, "larga")[0]).toBe(MON);
    expect(dates(out.sessions, "cola")[0] > dates(out.sessions, "larga")[0]).toBe(true);
  });

  it("con holgura igual desempata el deadline más cercano y después el orden original", () => {
    const out = schedule(input([
      project("p1", "2026-10-30", [sub("x", 120)]),
      project("p2", "2026-10-30", [sub("y", 120)])
    ], { params: { inflation: 1, maxSessionMin: 200 } }));
    expect(dates(out.sessions, "x")).toEqual([MON]);
    expect(dates(out.sessions, "y")).toEqual([TUE]);
  });
});

describe("caso que no entra", () => {
  // Miércoles 30/9: 3 días (lun, mar, mié) de 120 min = 360 disponibles, y hay 420.
  const seven = Array.from({ length: 7 }, (_, i) => sub(`s${i}`, 60));
  const out = schedule(input([project("p", WED, seven)]));

  it("no inventa un plan imposible: devuelve feasible=false y el faltante exacto", () => {
    expect(out.perProject.p.feasible).toBe(false);
    expect(out.perProject.p.shortfallMin).toBe(60);
    expect(out.sessions.reduce((sum, s) => sum + s.minutes, 0)).toBe(360);
    expect(out.sessions.every((s) => s.date <= WED)).toBe(true);
    expect(out.perProject.p.bufferConsumedPct).toBe(100);
  });

  it("calcula cuántos minutos extra por día harían falta", () => {
    // 420 en 3 días = 140 por día: 20 de más. Con 19 no alcanza.
    expect(out.perProject.p.options?.extraMinPerDay).toBe(20);
  });

  it("calcula qué fecha alcanzaría con la disponibilidad actual", () => {
    expect(out.perProject.p.options?.achievableDeadline).toBe(THU);
  });

  it("avisa INFEASIBLE", () => {
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: "INFEASIBLE", projectId: "p" }));
  });

  it("aplicar las opciones realmente lo hace entrar", () => {
    const moved = schedule(input([project("p", out.perProject.p.options!.achievableDeadline as string, seven)]));
    expect(moved.perProject.p.feasible).toBe(true);
    const richer = schedule(input([project("p", WED, seven)], {
      availability: Object.fromEntries(Object.entries(DEFAULT_AVAILABILITY).map(([k, v]) => [k, v + 20])) as typeof DEFAULT_AVAILABILITY
    }));
    expect(richer.perProject.p.feasible).toBe(true);
  });

  it("si el problema no es la capacidad, extraMinPerDay es null (cadena más larga que los días)", () => {
    const chain = schedule(input([
      project("p", TUE, [sub("a", 30), sub("b", 30, { dependsOn: ["a"] }), sub("c", 30, { dependsOn: ["b"] })])
    ]));
    expect(chain.perProject.p.feasible).toBe(false);
    expect(chain.perProject.p.options?.extraMinPerDay).toBeNull();
    expect(chain.perProject.p.options?.achievableDeadline).toBe(WED);
  });

  it("sin ninguna disponibilidad no hay opción de minutos, y sin fecha posible tampoco", () => {
    const zero = Object.fromEntries(Object.keys(DEFAULT_AVAILABILITY).map((k) => [k, 0])) as typeof DEFAULT_AVAILABILITY;
    const none = schedule(input([project("p", "2026-10-12", [sub("a", 60)])], { availability: zero }));
    expect(none.perProject.p.feasible).toBe(false);
    expect(none.perProject.p.shortfallMin).toBe(60);
    expect(none.perProject.p.options).toEqual({ extraMinPerDay: null, achievableDeadline: null });
    expect(none.sessions).toEqual([]);
  });

  it("un proyecto que no entra no le quita el lugar a uno que sí", () => {
    const both = schedule(input([
      project("imposible", TUE, [sub("big1", 200), sub("big2", 200), sub("big3", 200)]),
      project("facil", "2026-10-30", [sub("ok", 30)])
    ]));
    expect(both.perProject.imposible.feasible).toBe(false);
    expect(both.perProject.facil.feasible).toBe(true);
  });
});

describe("margen y aviso TIGHT", () => {
  const flat = Object.fromEntries(Object.keys(DEFAULT_AVAILABILITY).map((k) => [k, 60])) as typeof DEFAULT_AVAILABILITY;
  const many = (n: number) => Array.from({ length: n }, (_, i) => sub(`s${i}`, 60));

  it("termina antes del objetivo: sin margen gastado y sin aviso", () => {
    const out = schedule(input([project("p", addDays(TODAY, 10), many(5))], { availability: flat }));
    expect(out.perProject.p.bufferConsumedPct).toBe(0);
    expect(out.warnings.some((w) => w.code === "TIGHT")).toBe(false);
  });

  it("llega justo al deadline: margen 100% gastado y aviso TIGHT", () => {
    // 11 días de 60 min hasta el deadline (día +10): objetivo +8, buffer 2 días.
    const out = schedule(input([project("p", addDays(TODAY, 10), many(11))], { availability: flat }));
    expect(out.perProject.p.feasible).toBe(true);
    expect(out.perProject.p.plannedEndDate).toBe(addDays(TODAY, 10));
    expect(out.perProject.p.bufferDays).toBe(0);
    expect(out.perProject.p.bufferConsumedPct).toBe(100);
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: "TIGHT", projectId: "p" }));
  });

  it("gastar exactamente la mitad del margen todavía no es TIGHT", () => {
    const out = schedule(input([project("p", addDays(TODAY, 10), many(10))], { availability: flat }));
    expect(out.perProject.p.bufferConsumedPct).toBe(50);
    expect(out.warnings.some((w) => w.code === "TIGHT")).toBe(false);
  });
});

describe("deadlines extremos", () => {
  it("deadline hoy: entra si cabe hoy", () => {
    // Una subtarea usa a lo sumo una sesión de 90 min por día: 90 entra, 100 no.
    const out = schedule(input([project("p", TODAY, [sub("a", 90)])]));
    expect(out.perProject.p.feasible).toBe(true);
    expect(dates(out.sessions, "a")).toEqual([TODAY]);
    expect(out.perProject.p.bufferDays).toBe(0);
    expect(out.perProject.p.targetDate).toBe(TODAY);
  });

  it("deadline hoy: lo que no cabe queda como faltante", () => {
    const out = schedule(input([project("p", TODAY, [sub("a", 100), sub("b", 100)])]));
    expect(out.perProject.p.feasible).toBe(false);
    expect(out.perProject.p.shortfallMin).toBe(80);
    expect(out.sessions.every((s) => s.date === TODAY)).toBe(true);
    expect(out.perProject.p.options?.achievableDeadline).toBe(TUE);
  });

  it("deadline mañana: usa hoy y mañana", () => {
    const out = schedule(input([project("p", TUE, [sub("a", 120), sub("b", 120)])]));
    expect(out.perProject.p.feasible).toBe(true);
    expect(minutesOn(out.sessions, MON)).toBe(120);
    expect(minutesOn(out.sessions, TUE)).toBe(120);
    expect(out.perProject.p.targetDate).toBe(TODAY);
    expect(out.perProject.p.bufferDays).toBe(0);
  });

  it("deadline mañana: con poco trabajo termina hoy y sobra un día", () => {
    const out = schedule(input([project("p", TUE, [sub("a", 60)])]));
    expect(out.perProject.p.plannedEndDate).toBe(TODAY);
    expect(out.perProject.p.bufferDays).toBe(1);
    expect(out.perProject.p.bufferConsumedPct).toBe(0);
  });

  it("deadline vencido: nada entra, todo es faltante y se ofrece una fecha alcanzable", () => {
    const out = schedule(input([project("p", "2026-09-20", [sub("a", 60)])]));
    expect(out.perProject.p.feasible).toBe(false);
    expect(out.perProject.p.shortfallMin).toBe(60);
    expect(out.sessions).toEqual([]);
    expect(out.perProject.p.bufferDays).toBe(-8);
    expect(out.perProject.p.options?.achievableDeadline).toBe(TODAY);
  });

  it("nunca agenda después del deadline", () => {
    const out = schedule(input([project("p", WED, [sub("a", 300)])]));
    expect(out.sessions.every((s) => s.date <= WED)).toBe(true);
  });
});

describe("notBefore (saltear = diferir)", () => {
  it("no agenda una subtarea antes de su fecha", () => {
    const out = schedule(input([project("p", "2026-10-12", [sub("a", 60, { notBefore: WED }), sub("b", 60)])]));
    expect(dates(out.sessions, "a")).toEqual([WED]);
    expect(dates(out.sessions, "b")).toEqual([MON]);
  });

  it("los demás ocupan el lugar que deja y su sucesor espera", () => {
    const out = schedule(input([
      project("p", "2026-10-12", [sub("a", 60, { notBefore: TUE }), sub("b", 60, { dependsOn: ["a"] })])
    ]));
    expect(dates(out.sessions, "a")).toEqual([TUE]);
    expect(dates(out.sessions, "b")).toEqual([WED]);
  });

  it("si el deadline llega antes de la fecha, no entra", () => {
    const out = schedule(input([project("p", TUE, [sub("a", 60, { notBefore: WED })])]));
    expect(out.perProject.p.feasible).toBe(false);
    expect(out.perProject.p.shortfallMin).toBe(60);
  });

  it("una fecha inválida es un error explícito", () => {
    expect(() => schedule(input([project("p", "2026-10-12", [sub("a", 60, { notBefore: "mañana" })])]))).toThrow(SchedulerError);
  });

  it("replan no conserva una sesión anterior a su nuevo notBefore", () => {
    const first = schedule(input([project("p", "2026-10-12", [sub("a", 60)])]));
    expect(dates(first.sessions, "a")).toEqual([MON]);
    const out = replan(input([project("p", "2026-10-12", [sub("a", 60, { notBefore: TUE })])]), first);
    expect(dates(out.sessions, "a")).toEqual([TUE]);
  });
});

describe("estado de las subtareas", () => {
  it("las hechas no se agendan y no cuentan como faltante", () => {
    const out = schedule(input([project("p", "2026-10-12", [sub("a", 60, { done: true }), sub("b", 60)])]));
    expect(of(out.sessions, "a")).toEqual([]);
    expect(out.sessions.reduce((n, s) => n + s.minutes, 0)).toBe(60);
  });

  it("actualMin se descuenta de lo que falta", () => {
    const out = schedule(input([project("p", "2026-10-12", [sub("a", 120, { actualMin: 90 })])]));
    expect(out.sessions.reduce((n, s) => n + s.minutes, 0)).toBe(30);
  });

  it("un proyecto con todo hecho es factible y no tiene sesiones", () => {
    const out = schedule(input([project("p", "2026-10-12", [sub("a", 60, { done: true })])]));
    expect(out.sessions).toEqual([]);
    expect(out.perProject.p).toMatchObject({ feasible: true, shortfallMin: 0, plannedEndDate: null, bufferDays: 14 });
    expect(out.warnings).toEqual([]);
  });

  it("un proyecto sin subtareas tampoco rompe nada", () => {
    expect(schedule(input([project("p", "2026-10-12", [])])).perProject.p.feasible).toBe(true);
    expect(schedule(input([])).sessions).toEqual([]);
  });
});

describe("factor de inflación", () => {
  it("por defecto infla 1.3", () => {
    const out = schedule(input([project("p", "2026-10-30", [sub("a", 60)])], { params: {} }));
    expect(out.sessions.reduce((n, s) => n + s.minutes, 0)).toBe(78);
  });

  it("usa el factor aprendido del historial del usuario", () => {
    const history = [1.5, 1.5, 1.4, 1.6, 1.5].map((r) => ({ estimateMin: 60, actualMin: Math.round(60 * r) }));
    const learned = learnInflation(history);
    expect(learned).toMatchObject({ factor: 1.5, learned: true });
    const out = schedule(input([project("p", "2026-10-30", [sub("a", 60)])], { params: { inflation: learned.factor } }));
    expect(out.sessions.reduce((n, s) => n + s.minutes, 0)).toBe(90);
  });

  it("sin historial suficiente se queda con 1.3", () => {
    const learned = learnInflation([{ estimateMin: 60, actualMin: 120 }]);
    const out = schedule(input([project("p", "2026-10-30", [sub("a", 60)])], { params: { inflation: learned.factor } }));
    expect(out.sessions.reduce((n, s) => n + s.minutes, 0)).toBe(78);
  });

  it("un factor mayor puede volver infactible un plan que antes entraba", () => {
    const tight = project("p", WED, Array.from({ length: 6 }, (_, i) => sub(`s${i}`, 60)));
    expect(schedule(input([tight])).perProject.p.feasible).toBe(true);
    expect(schedule(input([tight], { params: { inflation: 1.5 } })).perProject.p.feasible).toBe(false);
  });
});

describe("replan", () => {
  const base = input([project("p", "2026-10-16", [sub("a", 100), sub("b", 60), sub("c", 90, { dependsOn: ["a"] }), sub("d", 60)])]);
  const strip = ({ sessions, perProject, warnings }: ReturnType<typeof schedule>) => ({ sessions, perProject, warnings });

  it("es estable: con el plan que él mismo devolvió, no cambia nada", () => {
    const first = schedule(base);
    const again = replan(base, first);
    expect(strip(again)).toEqual(strip(first));
    expect(again.changedSessions).toBe(0);
    expect(again.newlyInfeasible).toEqual([]);
    expect(again.newlyTight).toEqual([]);
  });

  it("mismo input, mismo output (y no muta el input)", () => {
    const frozen = structuredClone(base);
    expect(strip(replan(base))).toEqual(strip(replan(base)));
    expect(strip(schedule(base))).toEqual(strip(schedule(base)));
    expect(base).toEqual(frozen);
  });

  it("sin plan anterior equivale a schedule", () => {
    expect(strip(replan(base))).toEqual(strip(schedule(base)));
  });

  it("al avanzar un día con lo agendado hecho, el resto del plan no se mueve", () => {
    const first = schedule(base);
    const doneToday = new Set(first.sessions.filter((s) => s.date === MON && s.part === s.totalParts).map((s) => s.subtaskId));
    const next: ScheduleInput = {
      ...base,
      today: TUE,
      projects: [project("p", "2026-10-16", base.projects[0].subtasks.map((st) => ({
        ...st,
        done: doneToday.has(st.id),
        actualMin: first.sessions.filter((s) => s.subtaskId === st.id && s.date === MON).reduce((n, s) => n + s.minutes, 0)
      })))]
    };
    const out = replan(next, first);
    const before = first.sessions.filter((s) => s.date >= TUE).map(({ subtaskId, date, minutes }) => ({ subtaskId, date, minutes }));
    const after = out.sessions.map(({ subtaskId, date, minutes }) => ({ subtaskId, date, minutes }));
    expect(after).toEqual(before);
    expect(out.changedSessions).toBe(0);
  });

  it("tras saltear un día, lo no hecho vuelve a entrar desde hoy", () => {
    const first = schedule(base);
    const next: ScheduleInput = { ...base, today: TUE }; // no se hizo nada el lunes
    const out = replan(next, first);
    expect(out.sessions.every((s) => s.date >= TUE)).toBe(true);
    // Todo lo que faltaba sigue agendado (nada se perdió con el día saltado)...
    const total = (sessions: Session[]) => sessions.reduce((n, s) => n + s.minutes, 0);
    expect(total(out.sessions)).toBe(total(first.sessions));
    expect(out.perProject.p.feasible).toBe(true);
    // ...y lo que ya estaba agendado de mañana en adelante sigue en su lugar,
    // salvo lo que dependía de trabajo que se perdió ("c" depende de "a").
    const keep = first.sessions.filter((s) => s.date >= TUE && s.subtaskId !== "c");
    expect(keep.length).toBeGreaterThan(0);
    for (const s of keep) {
      expect(out.sessions).toContainEqual(expect.objectContaining({ subtaskId: s.subtaskId, date: s.date, minutes: s.minutes }));
    }
    // "c" solo puede empezar después de que "a" termine de nuevo.
    expect(dates(out.sessions, "c")[0] > (dates(out.sessions, "a").at(-1) as string)).toBe(true);
    expect(out.changedSessions).toBeGreaterThan(0);
  });

  it("un proyecto nuevo se acomoda sin mover lo que ya estaba agendado", () => {
    const first = schedule(base);
    const extra = project("nuevo", "2026-10-30", [sub("n1", 60)]);
    const out = replan({ ...base, projects: [...base.projects, extra] }, first);
    for (const s of first.sessions) {
      expect(out.sessions).toContainEqual(expect.objectContaining({ subtaskId: s.subtaskId, date: s.date, minutes: s.minutes }));
    }
    expect(out.perProject.nuevo.feasible).toBe(true);
  });

  it("si conservar el plan dejaría un proyecto peor que uno nuevo, gana el nuevo", () => {
    const first = schedule(input([project("holgado", "2026-11-30", [sub("h", 120)])]));
    const urgent = project("urgente", TUE, [sub("u1", 120), sub("u2", 120)]);
    const out = replan(input([project("holgado", "2026-11-30", [sub("h", 120)]), urgent]), first);
    expect(out.perProject.urgente.feasible).toBe(true);
  });

  it("alerta cuando un proyecto pasa a no ser factible", () => {
    const first = schedule(input([project("p", "2026-10-06", [sub("a", 100), sub("b", 100)])]));
    expect(first.perProject.p.feasible).toBe(true);
    const worse = input([project("p", "2026-10-06", [sub("a", 100), sub("b", 100)])], {
      overrides: { [TUE]: 0, [WED]: 0, [THU]: 0, "2026-10-02": 0, "2026-10-03": 0, "2026-10-04": 0, "2026-10-05": 0, "2026-10-06": 0 }
    });
    const out = replan(worse, first);
    expect(out.perProject.p.feasible).toBe(false);
    expect(out.newlyInfeasible).toEqual(["p"]);
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: "INFEASIBLE" }));
  });

  it("no alerta de nuevo si ya no era factible", () => {
    const hopeless = input([project("p", TODAY, [sub("a", 100), sub("b", 100)])]);
    const first = schedule(hopeless);
    const out = replan(hopeless, { sessions: first.sessions, perProject: first.perProject });
    expect(out.newlyInfeasible).toEqual([]);
  });

  it("alerta cuando el margen gastado pasa del 50%", () => {
    const flat = Object.fromEntries(Object.keys(DEFAULT_AVAILABILITY).map((k) => [k, 60])) as typeof DEFAULT_AVAILABILITY;
    const roomy = input([project("p", addDays(TODAY, 10), Array.from({ length: 5 }, (_, i) => sub(`s${i}`, 60)))], { availability: flat });
    const first = schedule(roomy);
    const heavier = input([project("p", addDays(TODAY, 10), Array.from({ length: 11 }, (_, i) => sub(`s${i}`, 60)))], { availability: flat });
    const out = replan(heavier, first);
    expect(out.newlyTight).toEqual(["p"]);
    // Sin perProject previo se compara contra "no estaba tight".
    expect(replan(heavier, { sessions: out.sessions }).newlyTight).toEqual(["p"]);
    expect(replan(heavier, { sessions: out.sessions, perProject: out.perProject }).newlyTight).toEqual([]);
  });

  it("descarta las sesiones de subtareas que ya se hicieron", () => {
    const first = schedule(base);
    const b = base.projects[0].subtasks.map((s) => (s.id === "b" ? { ...s, done: true } : s));
    const out = replan({ ...base, projects: [project("p", "2026-10-16", b)] }, first);
    expect(of(out.sessions, "b")).toEqual([]);
  });

  it("descarta una sesión que ya no tiene lugar (el día quedó lleno)", () => {
    const first = schedule(input([project("p", "2026-10-16", [sub("a", 60)])]));
    const busy = input([project("p", "2026-10-16", [sub("a", 60)])], { fixedLoad: { [MON]: 120 } });
    const out = replan(busy, first);
    expect(minutesOn(out.sessions, MON)).toBe(0);
    expect(out.perProject.p.feasible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Propiedades sobre entradas aleatorias (semilla fija: reproducible)
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInput(seed: number): ScheduleInput {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const availability = Object.fromEntries(
    Object.keys(DEFAULT_AVAILABILITY).map((k) => [k, r() < 0.15 ? 0 : int(30, 240)])
  ) as typeof DEFAULT_AVAILABILITY;

  const overrides: Record<string, number> = {};
  for (let i = 0; i < int(0, 4); i++) overrides[addDays(TODAY, int(0, 25))] = r() < 0.6 ? 0 : int(20, 300);
  const fixedLoad: Record<string, number> = {};
  for (let i = 0; i < int(0, 5); i++) fixedLoad[addDays(TODAY, int(0, 25))] = int(10, 200);

  const projects: SchedulerProject[] = [];
  for (let p = 0; p < int(1, 3); p++) {
    const subtasks: SchedulerSubtask[] = [];
    for (let s = 0; s < int(1, 7); s++) {
      const dependsOn = subtasks.filter(() => r() < 0.3).map((d) => d.id);
      subtasks.push({
        id: `p${p}s${s}`,
        estimateMin: int(5, 300),
        dependsOn,
        done: r() < 0.15,
        ...(r() < 0.2 ? { actualMin: int(0, 100) } : {})
      });
    }
    projects.push({
      id: `p${p}`,
      deadline: addDays(TODAY, int(-1, 28)),
      dailyCapMin: r() < 0.25 ? int(20, 120) : null,
      subtasks
    });
  }

  const params = { inflation: [1, 1.3, 1.5, 2][int(0, 3)], maxSessionMin: [40, 90, 120][int(0, 2)], minSessionMin: [10, 20, 30][int(0, 2)] };
  return { today: TODAY, availability, overrides, fixedLoad, projects, params };
}

describe("propiedades (400 entradas aleatorias)", () => {
  for (let seed = 1; seed <= 400; seed++) {
    it(`invariantes con la semilla ${seed}`, () => {
      const inp = randomInput(seed);
      const out = schedule(inp);
      const capOn = (d: string) => Math.max(0, capacityOn(d, inp.availability, inp.overrides) - (inp.fixedLoad?.[d] ?? 0));
      const byId = new Map(inp.projects.flatMap((p) => p.subtasks.map((s) => [s.id, { s, p }] as const)));
      const params = { inflation: inp.params!.inflation!, min: Math.min(inp.params!.minSessionMin!, Math.floor(inp.params!.maxSessionMin! / 2)) };

      // 1. Nada en el pasado ni después del deadline, y nunca de una subtarea hecha.
      for (const s of out.sessions) {
        const { s: st, p } = byId.get(s.subtaskId)!;
        expect(s.date >= TODAY && s.date <= p.deadline, `${s.subtaskId} ${s.date}`).toBe(true);
        expect(st.done).toBe(false);
        expect(s.minutes).toBeGreaterThan(0);
        expect(s.minutes).toBeLessThanOrEqual(inp.params!.maxSessionMin!);
        expect(s.projectId).toBe(p.id);
      }

      // 2. Nunca se pasa de la capacidad del día ni del tope del proyecto.
      for (const date of new Set(out.sessions.map((s) => s.date))) {
        expect(minutesOn(out.sessions, date)).toBeLessThanOrEqual(capOn(date));
        for (const p of inp.projects) {
          if (p.dailyCapMin == null) continue;
          const used = out.sessions.filter((s) => s.date === date && s.projectId === p.id).reduce((n, s) => n + s.minutes, 0);
          expect(used).toBeLessThanOrEqual(p.dailyCapMin);
        }
      }

      for (const [id, { s: st, p }] of byId) {
        const mine = of(out.sessions, id);
        const need = st.done ? 0 : Math.max(1, effectiveMinutes(st.estimateMin, params.inflation) - (st.actualMin ?? 0));
        const total = mine.reduce((n, x) => n + x.minutes, 0);

        // 3. Una sesión por día y nunca más de lo que falta; partes bien numeradas.
        expect(new Set(mine.map((x) => x.date)).size).toBe(mine.length);
        expect(total).toBeLessThanOrEqual(need);
        mine.forEach((x, i) => expect([x.part, x.totalParts]).toEqual([i + 1, mine.length]));

        // 4. Ninguna sesión bajo el mínimo salvo la última.
        mine.slice(0, -1).forEach((x) => expect(x.minutes).toBeGreaterThanOrEqual(params.min));

        // 5. Dependencias: un sucesor solo tiene sesiones si la dependencia sin hacer
        // está completa y terminó antes de su primer día.
        if (mine.length > 0) {
          for (const dep of st.dependsOn) {
            const d = byId.get(dep)!.s;
            if (d.done) continue;
            const depNeed = Math.max(1, effectiveMinutes(d.estimateMin, params.inflation) - (d.actualMin ?? 0));
            const depSessions = of(out.sessions, dep);
            expect(depSessions.reduce((n, x) => n + x.minutes, 0)).toBe(depNeed);
            expect(depSessions.at(-1)!.date < mine[0].date).toBe(true);
          }
        }

        // 6. Si el proyecto es factible, todo lo pendiente quedó completo.
        if (out.perProject[p.id].feasible) expect(total).toBe(need);
      }

      // 7. shortfall coherente con lo agendado.
      for (const p of inp.projects) {
        const need = p.subtasks.filter((s) => !s.done).reduce((n, s) => n + Math.max(1, effectiveMinutes(s.estimateMin, params.inflation) - (s.actualMin ?? 0)), 0);
        const planned = out.sessions.filter((s) => s.projectId === p.id).reduce((n, s) => n + s.minutes, 0);
        const plan = out.perProject[p.id];
        expect(plan.shortfallMin).toBe(need - planned);
        expect(plan.feasible).toBe(plan.shortfallMin === 0);
        expect(plan.bufferConsumedPct).toBeGreaterThanOrEqual(0);
        expect(plan.bufferConsumedPct).toBeLessThanOrEqual(100);
        if (plan.plannedEndDate) expect(plan.bufferDays).toBe(daysBetween(plan.plannedEndDate, p.deadline));
        expect(Boolean(plan.options)).toBe(!plan.feasible);
      }

      // 8. Determinismo y estabilidad.
      expect(schedule(inp)).toEqual(out);
      const again = replan(inp, out);
      expect({ sessions: again.sessions, perProject: again.perProject, warnings: again.warnings }).toEqual(out);
    });
  }
});
