import { describe, expect, it } from "vitest";
import { parseScope, parseTaskPayload } from "@/lib/task-validation";

const valid = {
  id: "t1",
  title: "Gimnasio",
  category: "salud",
  description: "",
  priority: "medium",
  estimateMin: 60,
  dueDate: "2026-09-30",
  done: false,
  kind: "task"
};

const ok = (value: unknown) => {
  const result = parseTaskPayload(value);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
};
const error = (value: unknown) => {
  const result = parseTaskPayload(value);
  return result.ok ? null : result.error;
};

describe("parseTaskPayload", () => {
  it("acepta una tarea completa", () => {
    expect(ok(valid).task).toMatchObject({
      id: "t1", kind: "task", estimateMin: 60, status: "pending", done: false
    });
  });

  it("rechaza lo que no es una tarea", () => {
    expect(error(null)).toBe("Invalid task data");
    expect(error("hola")).toBe("Invalid task data");
    expect(error({ ...valid, title: 5 })).toBe("Invalid task data");
    expect(error({ ...valid, priority: "urgente" })).toBe("Invalid task data");
    expect(error({ ...valid, title: "x".repeat(201) })).toBe("Invalid task data");
  });

  it("valida kind, minutos y hora", () => {
    expect(error({ ...valid, kind: "epica" })).toBe("Invalid kind");
    expect(error({ ...valid, estimateMin: 0 })).toBe("Invalid estimate");
    expect(error({ ...valid, estimateMin: 12.5 })).toBe("Invalid estimate");
    expect(error({ ...valid, estimateMin: 5000 })).toBe("Invalid estimate");
    expect(error({ ...valid, time: "25:00" })).toBe("Invalid time");
    expect(error({ ...valid, time: "9:30" })).toBe("Invalid time");
    expect(ok({ ...valid, time: "09:30" }).task.time).toBe("09:30");
    expect(ok({ ...valid, time: null }).task).not.toHaveProperty("time");
  });

  it("un cliente con la versión anterior sigue pudiendo guardar", () => {
    const legacy = { ...valid, duration: "long" } as Record<string, unknown>;
    delete legacy.estimateMin;
    delete legacy.kind;
    const { task } = ok(legacy);
    expect(task.estimateMin).toBe(120);
    expect(task.kind).toBe("task");
    const noDuration = { ...valid } as Record<string, unknown>;
    delete noDuration.estimateMin;
    expect(error(noDuration)).toBe("Invalid task data");
  });

  it("no acepta del cliente ni el estado ni la identidad de la ocurrencia", () => {
    const { task } = ok({
      ...valid, seriesId: "de-otro", occurrenceDate: "2026-01-01", status: "skipped"
    });
    expect(task).not.toHaveProperty("seriesId");
    expect(task).not.toHaveProperty("occurrenceDate");
    expect(task.status).toBe("pending");
    expect(ok({ ...valid, done: true, status: "pending" }).task.status).toBe("done");
  });

  it("acepta repeat y lo normaliza", () => {
    const { repeat } = ok({ ...valid, repeat: { freq: "weekly", weekdays: [6, 3] } });
    expect(repeat).toEqual({ freq: "weekly", interval: 1, weekdays: [3, 6] });
  });

  it("rechaza un repeat inválido en vez de ignorarlo en silencio", () => {
    expect(error({ ...valid, repeat: { freq: "weekly", weekdays: [9] } })).toBe("Invalid repeat");
    expect(error({ ...valid, repeat: { freq: "yearly" } })).toBe("Invalid repeat");
  });

  it("un proyecto no puede repetirse", () => {
    expect(error({ ...valid, kind: "project", repeat: { freq: "daily" } })).toBe("A project cannot repeat");
    expect(ok({ ...valid, kind: "project" }).task.kind).toBe("project");
  });

  it("una serie necesita una fecha de inicio real y un fin coherente", () => {
    expect(error({ ...valid, dueDate: "pronto", repeat: { freq: "daily" } })).toBe("Invalid due date");
    expect(error({ ...valid, dueDate: "2026-02-31", repeat: { freq: "daily" } })).toBe("Invalid due date");
    expect(
      error({ ...valid, dueDate: "2026-10-10", repeat: { freq: "daily", until: "2026-10-01" } })
    ).toBe("Invalid repeat end");
    expect(
      ok({ ...valid, dueDate: "2026-10-10", repeat: { freq: "daily", until: "2026-12-31" } }).repeat?.until
    ).toBe("2026-12-31");
  });
});

describe("parseScope", () => {
  it("solo 'following' cambia el alcance; todo lo demás es 'esta'", () => {
    expect(parseScope("following")).toBe("following");
    expect(parseScope("this")).toBe("this");
    expect(parseScope(undefined)).toBe("this");
    expect(parseScope("todas")).toBe("this");
  });
});
