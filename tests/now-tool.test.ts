import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { busyLoadByDate, collectBusyBlocks, type BusyBlock } from "@/lib/busy-blocks";
import { executeTool, existingEntries, type ScheduleData, type ToolContext } from "@/lib/milo-tools";
import { mergeLoads, planProjects } from "@/lib/project-scheduling";
import { planWeek } from "@/lib/week-planner";

const BA = "America/Argentina/Buenos_Aires";
// Martes 2026-09-29 10:00 en Buenos Aires
const NOW = new Date("2026-09-29T13:00:00Z");
const TODAY = "2026-09-29";

const blockIn = (min: number, over: Partial<BusyBlock> = {}): BusyBlock => ({
  id: "cal1", title: "Kinesiología", source: "calendar", importance: "normal", prepMin: 15,
  start: new Date(NOW.getTime() + min * 60_000).toISOString(),
  end: new Date(NOW.getTime() + (min + 60) * 60_000).toISOString(),
  ...over
});
const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: id, category: "general", priority: "medium", estimateMin: 30, dueDate: "2026-10-20",
  done: false, status: "pending", kind: "task", ...over
});

function ctxWith(data: Partial<ScheduleData>): ToolContext {
  const full: ScheduleData = {
    tasks: [], sessions: [], availability: DEFAULT_AVAILABILITY, overrides: {}, inflation: 1, busyBlocks: [], timeZone: BA, ...data
  } as ScheduleData;
  return { today: TODAY, now: NOW, load: vi.fn(async () => full) } as never;
}
const call = async (ctx: ToolContext, args: Record<string, unknown> = {}) => {
  const out = await executeTool({ id: "c", name: "what_should_i_do_now", arguments: JSON.stringify(args) }, ctx);
  return { out, body: JSON.parse(out.content) };
};

describe("what_should_i_do_now", () => {
  it("'tengo media hora': usa availableMin y recomienda algo que entre", async () => {
    const { body } = await call(ctxWith({ tasks: [task("larga", { estimateMin: 90, priority: "high" }), task("mediana", { estimateMin: 25 })] as never }), { availableMin: 30 });
    expect(body.ok).toBe(true);
    expect(body.freeMin).toBe(30);
    expect(body.minutesSource).toMatch(/usuario/);
    expect(body.recommendation).toMatchObject({ type: "task", title: "mediana", mode: "finish" });
    expect(body.recommendation.reason).toMatch(/entra en tus 30 min/i);
  });

  it("sin tiempo dicho usa la ventana libre y nombra el evento cercano", async () => {
    const { body } = await call(ctxWith({ busyBlocks: [blockIn(60)], tasks: [task("corta", { estimateMin: 20 })] as never }));
    expect(body.freeMin).toBe(45); // 60 - 15 de margen
    expect(body.freeText).toBe("Tenés ~45 min libres (hasta Kinesiología 11:00)");
    expect(body.nextCommitment).toMatchObject({ title: "Kinesiología", startsAt: "11:00" });
    expect(body.recommendation.title).toBe("corta");
  });

  it("evento cerca y nada entra: descansá o preparate, con el motivo", async () => {
    const { body } = await call(ctxWith({ busyBlocks: [blockIn(40, { title: "Cumpleaños" })], tasks: [task("larga", { estimateMin: 120 })] as never }));
    expect(body.recommendation.type).toBe("prepare"); // evento de calendario
    expect(body.recommendation.reason).toBe("Tenés 25 min hasta Cumpleaños (10:40). Nada urgente entra: descansá o preparate.");
  });

  it("un tiempo dicho nunca pasa por encima del próximo compromiso", async () => {
    const { body } = await call(ctxWith({ busyBlocks: [blockIn(45)] }), { availableMin: 120 });
    expect(body.freeMin).toBe(30);
  });

  it("cansado: prefiere lo corto", async () => {
    const tasks = [task("informe", { estimateMin: 60, priority: "high", dueDate: "2026-09-30" }), task("mail", { estimateMin: 10 })];
    expect((await call(ctxWith({ tasks: tasks as never }))).body.recommendation.title).toBe("informe");
    expect((await call(ctxWith({ tasks: tasks as never }), { energy: "tired" })).body.recommendation.title).toBe("mail");
  });

  it("nada que hacer: descansar, sin inventar una tarea", async () => {
    const { body } = await call(ctxWith({}));
    expect(body.recommendation.type).toBe("rest");
    expect(body.recommendation.title).toBeUndefined();
    expect(body.recommendation.reason).toMatch(/nada pendiente/i);
  });

  it("las sesiones de proyecto de hoy compiten y se pueden avanzar", async () => {
    const data = { sessions: [{ date: TODAY, minutes: 90, title: "TFG · Capítulo 2", subtaskId: "s2", deadline: "2026-10-05" }, { date: "2026-10-01", minutes: 60, title: "TFG · Otro", subtaskId: "s3", deadline: "2026-10-05" }] };
    const { body } = await call(ctxWith(data), { availableMin: 40 });
    expect(body.recommendation).toMatchObject({ type: "task", title: "TFG · Capítulo 2", mode: "advance", minutes: 40, totalMinutes: 90 });
  });

  it("valida los argumentos y no falla con la base", async () => {
    for (const args of [{ availableMin: 0 }, { availableMin: "30" }, { availableMin: 5000 }, { energy: "sleepy" }]) {
      const { out } = await call(ctxWith({}), args);
      expect(out.isError).toBe(true);
    }
  });

  it("es de solo lectura: no propone tareas ni cierra el turno", async () => {
    const { out } = await call(ctxWith({ tasks: [task("a")] as never }));
    expect(out.effect).toBeUndefined();
  });

  it("un userId por argumento no llega a ningún lado", async () => {
    const ctx = ctxWith({});
    await call(ctx, { userId: "otro" });
    expect(ctx.load).toHaveBeenCalledWith();
  });
});

describe("nada se agenda encima de un compromiso", () => {
  const event = blockIn(0, { id: "boda", title: "Casamiento", start: "2026-09-30T15:00:00Z", end: "2026-09-30T23:00:00Z", prepMin: 60 }); // miércoles: 8 h + 1 h de margen

  it("plan_week: el evento le resta al día (Milo lo ve como agendado)", () => {
    const data = { tasks: [], sessions: [], busyBlocks: [event], timeZone: BA, availability: DEFAULT_AVAILABILITY, overrides: {}, inflation: 1 } as ScheduleData;
    expect(existingEntries(data)).toContainEqual({ date: "2026-09-30", title: "Casamiento", minutes: 540 });
    const plan = planWeek({
      today: TODAY, weekStart: "2026-09-28", availability: DEFAULT_AVAILABILITY, existing: existingEntries(data),
      items: [{ title: "Informe", kind: "task", estimateMin: 90, priority: "medium" }]
    });
    const placed = plan.placed[0];
    expect(placed.date).not.toBe("2026-09-30"); // el miércoles ya no tiene lugar (2 h de disponibilidad, 9 h ocupadas)
  });

  it("el scheduler de proyectos usa la carga de la agenda como capacidad ocupada", () => {
    const load = busyLoadByDate([event], BA);
    expect(load).toEqual({ "2026-09-30": 540 });
    const run = (busyLoad?: Record<string, number>) =>
      planProjects({
        today: TODAY, availability: DEFAULT_AVAILABILITY, overrides: {}, tasks: [], previousSessions: [], busyLoad,
        projects: [{ id: "p", deadline: "2026-10-03", subtasks: [{ id: "s", estimateMin: 200, dependsOn: [], done: false }] }]
      }).sessions.filter((s) => s.date === "2026-09-30").reduce((sum, s) => sum + s.minutes, 0);
    expect(run()).toBeGreaterThan(0);
    expect(run(load)).toBe(0);
  });

  it("lo que ya es carga fija (recordatorios con hora) no se descuenta dos veces: solo su margen", () => {
    const reminder = { id: "r", title: "Llamar", kind: "reminder", priority: "medium", estimateMin: 5, dueDate: "2026-09-30", time: "10:00", done: false, status: "pending" } as never;
    const blocks = collectBusyBlocks([reminder], { timeZone: BA, from: TODAY, to: "2026-10-05", prep: { calendarMin: 15, reminderMin: 0 } });
    expect(busyLoadByDate(blocks, BA)).toEqual({});
    const withPrep = collectBusyBlocks([reminder], { timeZone: BA, from: TODAY, to: "2026-10-05", prep: { calendarMin: 15, reminderMin: 10 } });
    expect(busyLoadByDate(withPrep, BA)).toEqual({ "2026-09-30": 10 });
  });

  it("mergeLoads suma por fecha", () => {
    expect(mergeLoads({ a: 10 }, { a: 5, b: 1 }, undefined)).toEqual({ a: 15, b: 1 });
  });
});
