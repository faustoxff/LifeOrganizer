import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import {
  ASK_USER,
  CREATE_ITEMS,
  CREATE_ITEMS_MAX,
  executeTool,
  GET_SCHEDULE,
  MILO_TOOLS,
  PLAN_WEEK,
  QUESTION_MAX,
  SCHEDULE_MAX_DAYS,
  type ScheduleData,
  type ToolContext
} from "@/lib/milo-tools";
import { MAX_WEEK_ITEMS } from "@/lib/week-planner";

// Lunes 2026-09-28.
const TODAY = "2026-09-28";
const NOW = new Date("2026-09-28T12:00:00.000Z");

const data = (overrides: Partial<ScheduleData> = {}): ScheduleData => ({
  tasks: [],
  sessions: [],
  availability: DEFAULT_AVAILABILITY,
  overrides: {},
  inflation: 1,
  ...overrides
});

function context(scheduleData: ScheduleData = data()) {
  const load = vi.fn(async () => scheduleData);
  const ctx: ToolContext = { today: TODAY, now: NOW, load };
  return { ctx, load };
}

const call = (name: string, args: unknown) => ({
  id: "c1",
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args)
});

const parse = (content: string) => JSON.parse(content) as Record<string, any>;

describe("especificación", () => {
  it("son las cuatro tools pedidas, con nombre y esquema", () => {
    expect(MILO_TOOLS.map((t) => t.name)).toEqual(["create_items", "plan_week", "get_schedule", "ask_user"]);
    for (const tool of [CREATE_ITEMS, PLAN_WEEK, GET_SCHEDULE, ASK_USER]) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters.type).toBe("object");
      expect(Array.isArray(tool.parameters.required)).toBe(true);
    }
  });
});

describe("argumentos", () => {
  it("un JSON roto se devuelve como error legible, sin tocar la base", async () => {
    const { ctx, load } = context();
    const out = await executeTool(call("create_items", "{items: [ "), ctx);
    expect(out.isError).toBe(true);
    expect(parse(out.content).error).toMatch(/JSON/);
    expect(load).not.toHaveBeenCalled();
  });

  it("los argumentos tienen que ser un objeto", async () => {
    const { ctx } = context();
    expect((await executeTool(call("ask_user", "[1,2]"), ctx)).isError).toBe(true);
    expect((await executeTool(call("ask_user", '"hola"'), ctx)).isError).toBe(true);
  });

  it("una tool que no existe lista las que sí", async () => {
    const { ctx } = context();
    const out = await executeTool(call("delete_everything", {}), ctx);
    expect(out.isError).toBe(true);
    expect(parse(out.content).error).toContain("create_items");
  });
});

describe("create_items", () => {
  it("propone los ítems normalizados y no crea nada", async () => {
    const { ctx, load } = context();
    const out = await executeTool(
      call("create_items", {
        items: [
          { title: "Banco", kind: "reminder", dueDate: "2026-09-29", time: "10:00" },
          { title: "Gimnasio", kind: "task", dueDate: "2026-09-30", repeat: { freq: "weekly", weekdays: [3, 6] } }
        ]
      }),
      ctx
    );
    expect(out.isError).toBeUndefined();
    expect(out.effect?.taskActions).toHaveLength(2);
    expect(out.effect?.taskActions?.[0]).toMatchObject({ title: "Banco", kind: "reminder", dueDate: "2026-09-29", time: "10:00" });
    expect(out.effect?.taskActions?.[1].repeat).toMatchObject({ freq: "weekly", weekdays: [3, 6] });
    expect(parse(out.content).note).toMatch(/Todavía no se creó nada/);
    expect(load).not.toHaveBeenCalled();
  });

  it("completa lo que falta con los defaults de siempre (estimación por tipo, prioridad media)", async () => {
    const { ctx } = context();
    const out = await executeTool(call("create_items", { items: [{ title: "Llamar", kind: "reminder", dueDate: "2026-09-29" }] }), ctx);
    expect(out.effect?.taskActions?.[0]).toMatchObject({ estimateMin: 5, priority: "medium", category: "general" });
  });

  it("descarta el ítem malo, conserva los buenos y lo dice", async () => {
    const { ctx } = context();
    const out = await executeTool(
      call("create_items", {
        items: [
          { title: "Bien", kind: "task", dueDate: "2026-09-29" },
          { title: "  ", kind: "task", dueDate: "2026-09-29" },
          { title: "Fecha mala", kind: "task", dueDate: "mañana" },
          { title: "Hora mala", kind: "reminder", dueDate: "2026-09-29", time: "25:99" },
          "no soy un objeto"
        ]
      }),
      ctx
    );
    expect(out.effect?.taskActions?.map((t) => t.title)).toEqual(["Bien"]);
    expect(parse(out.content).rejected.map((r: any) => r.index)).toEqual([1, 2, 3, 4]);
  });

  it("falla si no queda ningún ítem válido", async () => {
    const { ctx } = context();
    const out = await executeTool(call("create_items", { items: [{ kind: "task" }] }), ctx);
    expect(out.isError).toBe(true);
    expect(out.effect).toBeUndefined();
  });

  it("exige una lista no vacía y con tope", async () => {
    const { ctx } = context();
    expect((await executeTool(call("create_items", {}), ctx)).isError).toBe(true);
    expect((await executeTool(call("create_items", { items: [] }), ctx)).isError).toBe(true);
    expect((await executeTool(call("create_items", { items: "x" }), ctx)).isError).toBe(true);
    const many = Array.from({ length: CREATE_ITEMS_MAX + 1 }, (_, n) => ({ title: `T${n}`, kind: "task", dueDate: "2026-09-29" }));
    expect((await executeTool(call("create_items", { items: many }), ctx)).isError).toBe(true);
    const exact = many.slice(0, CREATE_ITEMS_MAX);
    expect((await executeTool(call("create_items", { items: exact }), ctx)).effect?.taskActions).toHaveLength(CREATE_ITEMS_MAX);
  });

  it("rechaza un título desmesurado", async () => {
    const { ctx } = context();
    const out = await executeTool(call("create_items", { items: [{ title: "x".repeat(500), kind: "task", dueDate: "2026-09-29" }] }), ctx);
    expect(out.isError).toBe(true);
  });

  it("un repeat roto cuesta la recurrencia, no el ítem", async () => {
    const { ctx } = context();
    const out = await executeTool(
      call("create_items", { items: [{ title: "Gym", kind: "task", dueDate: "2026-09-29", repeat: { freq: "weekly", weekdays: [3, 9] } }] }),
      ctx
    );
    expect(out.effect?.taskActions).toHaveLength(1);
    expect(out.effect?.taskActions?.[0].repeat).toBeUndefined();
  });
});

describe("ask_user", () => {
  it("devuelve la pregunta como efecto", async () => {
    const { ctx } = context();
    const out = await executeTool(call("ask_user", { question: " ¿Cuánto dura el informe? " }), ctx);
    expect(out.effect?.ask).toBe("¿Cuánto dura el informe?");
  });

  it("rechaza vacía o larguísima", async () => {
    const { ctx } = context();
    expect((await executeTool(call("ask_user", { question: "   " }), ctx)).isError).toBe(true);
    expect((await executeTool(call("ask_user", {}), ctx)).isError).toBe(true);
    expect((await executeTool(call("ask_user", { question: "?".repeat(QUESTION_MAX + 1) }), ctx)).isError).toBe(true);
  });
});

describe("get_schedule", () => {
  const schedule = data({
    tasks: [
      { title: "TP de álgebra", kind: "task", priority: "high", estimateMin: 120, dueDate: "2026-09-29", done: false, status: "pending" },
      { title: "Hecha", kind: "task", priority: "low", estimateMin: 30, dueDate: "2026-09-29", done: true, status: "done" },
      { title: "Salteada", kind: "task", priority: "low", estimateMin: 30, dueDate: "2026-09-29", done: false, status: "skipped" },
      { title: "Vencida", kind: "task", priority: "medium", estimateMin: 20, dueDate: "2026-09-20", done: false, status: "pending" },
      { title: "Proyecto TFG", kind: "project", priority: "high", estimateMin: 600, dueDate: "2026-10-30", done: false, status: "pending" },
      { title: "Gimnasio", kind: "task", priority: "medium", estimateMin: 60, dueDate: "2026-09-30", time: "18:00", done: false, status: "pending", seriesId: "s1" }
    ],
    sessions: [{ date: "2026-09-29", minutes: 45, title: "TFG · Capítulo 1" }]
  });

  it("devuelve por día lo agendado, la capacidad y lo que queda libre", async () => {
    const { ctx } = context(schedule);
    const out = await executeTool(call("get_schedule", { from: "2026-09-28", to: "2026-09-30" }), ctx);
    const body = parse(out.content);
    expect(body.days.map((d: any) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);

    const [mon, tue, wed] = body.days;
    // Lo vencido cuenta hoy.
    expect(mon.items.map((i: any) => i.title)).toEqual(["Vencida"]);
    expect(mon.items[0].overdue).toBe(true);
    expect(mon).toMatchObject({ weekday: "lunes", capacityMin: 120, plannedMin: 20, freeMin: 100 });
    // Ni hechas ni salteadas ni el proyecto en sí; sí la sesión del proyecto.
    expect(tue.items.map((i: any) => i.title)).toEqual(["TP de álgebra", "TFG · Capítulo 1"]);
    expect(tue).toMatchObject({ plannedMin: 165, freeMin: 0 });
    expect(wed.items[0]).toMatchObject({ title: "Gimnasio", time: "18:00", recurring: true });
  });

  it("avisa cuando el rango pasa lo que ya está generado de las recurrentes", async () => {
    const { ctx } = context(schedule);
    const near = parse((await executeTool(call("get_schedule", { from: TODAY, to: "2026-10-05" }), ctx)).content);
    expect(near.note).toBeUndefined();
    const far = parse((await executeTool(call("get_schedule", { from: TODAY, to: "2026-10-25" }), ctx)).content);
    expect(far.note).toMatch(/2026-10-11/);
  });

  it("valida el rango antes de leer la base", async () => {
    const { ctx, load } = context(schedule);
    const bad = [
      { from: "hoy", to: "2026-09-30" },
      { from: "2026-09-30", to: "2026-09-28" },
      { from: "2026-09-01", to: "2026-12-31" },
      { from: "2026-09-28" },
      {}
    ];
    for (const args of bad) expect((await executeTool(call("get_schedule", args), ctx)).isError, JSON.stringify(args)).toBe(true);
    expect(load).not.toHaveBeenCalled();
    // 31 días justos sí; 32 no.
    const max = await executeTool(call("get_schedule", { from: "2026-09-28", to: "2026-10-28" }), ctx);
    expect(max.isError).toBeUndefined();
    expect(SCHEDULE_MAX_DAYS).toBe(31);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("si la base falla devuelve un error para el modelo y no tira", async () => {
    const ctx: ToolContext = { today: TODAY, now: NOW, load: async () => { throw new Error("db caída"); } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await executeTool(call("get_schedule", { from: TODAY, to: TODAY }), ctx);
    expect(out.isError).toBe(true);
    expect(parse(out.content).error).toMatch(/agenda/);
    spy.mockRestore();
  });
});

describe("plan_week", () => {
  const items = [
    { title: "Informe", kind: "task", estimateMin: 90 },
    { title: "Turno médico", kind: "reminder", estimateMin: 30, dueDate: "2026-10-01", time: "09:30" },
    { title: "Leer", kind: "task", estimateMin: 45, priority: "low" }
  ];

  it("devuelve la propuesta por día con razones, y los ítems a crear con la fecha que les tocó", async () => {
    const { ctx, load } = context();
    const out = await executeTool(call("plan_week", { items }), ctx);
    expect(out.isError).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);

    const proposal = out.effect!.proposal!;
    expect(proposal.days).toHaveLength(7);
    const all = proposal.days.flatMap((d) => d.items);
    expect(all.map((i) => i.title).sort()).toEqual(["Informe", "Leer", "Turno médico"]);
    expect(all.find((i) => i.title === "Turno médico")).toMatchObject({ date: "2026-10-01", fixed: true });

    const actions = out.effect!.taskActions!;
    expect(actions.map((a) => a.title)).toEqual(["Informe", "Turno médico", "Leer"]);
    expect(actions.find((a) => a.title === "Turno médico")).toMatchObject({ dueDate: "2026-10-01", time: "09:30", kind: "reminder" });
    for (const action of actions) expect(action.dueDate >= TODAY).toBe(true);

    const body = parse(out.content);
    expect(body.days[0].items === undefined).toBe(false);
    expect(body.note).toMatch(/todavía no se creó nada/i);
  });

  it("los flexibles se reparten y los de fecha fija no se mueven", async () => {
    const { ctx } = context();
    const out = await executeTool(
      call("plan_week", {
        items: [
          { title: "A", kind: "task", estimateMin: 30 },
          { title: "B", kind: "task", estimateMin: 30 },
          { title: "C", kind: "task", estimateMin: 30 },
          { title: "Parcial", kind: "task", estimateMin: 120, dueDate: "2026-09-30", priority: "high" }
        ]
      }),
      ctx
    );
    const actions = out.effect!.taskActions!;
    expect(actions.find((a) => a.title === "Parcial")!.dueDate).toBe("2026-09-30");
    expect(new Set(actions.filter((a) => a.title.length === 1).map((a) => a.dueDate)).size).toBe(3);
  });

  it("tiene en cuenta lo que ya está agendado", async () => {
    const { ctx } = context(
      data({ tasks: [{ title: "TP", kind: "task", priority: "medium", estimateMin: 120, dueDate: TODAY, done: false, status: "pending" }] })
    );
    const out = await executeTool(call("plan_week", { items: [{ title: "Informe", kind: "task", estimateMin: 60 }] }), ctx);
    expect(out.effect!.taskActions![0].dueDate).not.toBe(TODAY);
    expect(parse(out.content).days[0].alreadyPlanned).toBe("2 h");
  });

  it("aplica la inflación aprendida solo a los ítems nuevos", async () => {
    const { ctx } = context(data({ inflation: 2 }));
    const out = await executeTool(call("plan_week", { items: [{ title: "Leer", kind: "task", estimateMin: 60, dueDate: TODAY }] }), ctx);
    expect(out.effect!.proposal!.days[0].plannedMin).toBe(120);
  });

  it("weekStart mueve la ventana; por defecto es hoy", async () => {
    const { ctx } = context();
    const next = await executeTool(call("plan_week", { items: [{ title: "A", kind: "task" }], weekStart: "2026-10-05" }), ctx);
    expect(next.effect!.proposal!.days[0].date).toBe("2026-10-05");
    const def = await executeTool(call("plan_week", { items: [{ title: "A", kind: "task" }] }), ctx);
    expect(def.effect!.proposal!.weekStart).toBe(TODAY);
  });

  it("valida weekStart", async () => {
    const { ctx } = context();
    for (const weekStart of ["lunes", "2026-08-01", "2027-06-01"]) {
      expect((await executeTool(call("plan_week", { items: [{ title: "A", kind: "task" }], weekStart }), ctx).then((o) => o.isError)), weekStart).toBe(true);
    }
  });

  it("un proyecto no entra en la semana y se le dice al modelo por qué", async () => {
    const { ctx } = context();
    const out = await executeTool(
      call("plan_week", { items: [{ title: "Tesis", kind: "project" }, { title: "Leer", kind: "task" }] }),
      ctx
    );
    expect(out.effect!.taskActions!.map((a) => a.title)).toEqual(["Leer"]);
    expect(parse(out.content).rejected[0].reason).toMatch(/proyecto/);
  });

  it("lo que no entra sale como doesNotFit con la razón, y no se crea", async () => {
    const { ctx } = context();
    const many = Array.from({ length: 20 }, (_, n) => ({ title: `Tarea ${n}`, kind: "task", estimateMin: 60, priority: n < 10 ? "high" : "low" }));
    const out = await executeTool(call("plan_week", { items: many }), ctx);
    const body = parse(out.content);
    expect(body.doesNotFit.length).toBeGreaterThan(0);
    expect(body.doesNotFit[0].why).toMatch(/Necesita .* solo quedan .*Sugerencia/);
    const created = out.effect!.taskActions!.length;
    expect(created + out.effect!.proposal!.deferred.length).toBe(20);
  });

  it("una recurrencia es un solo ítem con repeat", async () => {
    const { ctx } = context();
    const out = await executeTool(
      call("plan_week", { items: [{ title: "Gimnasio", kind: "task", estimateMin: 60, repeat: { freq: "weekly", weekdays: [3, 6] } }] }),
      ctx
    );
    expect(out.effect!.taskActions).toHaveLength(1);
    expect(out.effect!.taskActions![0].repeat).toMatchObject({ freq: "weekly", weekdays: [3, 6] });
    expect(out.effect!.taskActions![0].dueDate).toBe("2026-09-30");
  });

  it("exige una lista con tope y valida sin leer la base", async () => {
    const { ctx, load } = context();
    expect((await executeTool(call("plan_week", {}), ctx)).isError).toBe(true);
    expect((await executeTool(call("plan_week", { items: [] }), ctx)).isError).toBe(true);
    const tooMany = Array.from({ length: MAX_WEEK_ITEMS + 1 }, (_, n) => ({ title: `T${n}`, kind: "task" }));
    expect((await executeTool(call("plan_week", { items: tooMany }), ctx)).isError).toBe(true);
    expect((await executeTool(call("plan_week", { items: [{ kind: "task" }] }), ctx)).isError).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });
});
