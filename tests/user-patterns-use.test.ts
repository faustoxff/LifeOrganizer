import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { executeTool, type ToolContext } from "@/lib/milo-tools";
import { planProjects } from "@/lib/project-scheduling";
import { computePatterns, type HistoryEntry } from "@/lib/user-patterns";
import { planWeek } from "@/lib/week-planner";

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  title: "t", category: "study", estimateMin: 30, actualMin: 45, completed: true, completedHour: 9, postponedCount: 0, ...over
});
const many = (n: number, over: Partial<HistoryEntry> = {}) => Array.from({ length: n }, () => entry(over));

function ctxWith(history: HistoryEntry[]): ToolContext & { read: ReturnType<typeof vi.fn> } {
  const read = vi.fn(async () => computePatterns(history));
  return { today: "2026-09-28", now: new Date("2026-09-28T12:00:00Z"), load: vi.fn(), patterns: read, read } as never;
}
const call = (ctx: ToolContext, args: Record<string, unknown> = {}) =>
  executeTool({ id: "c1", name: "get_my_patterns", arguments: JSON.stringify(args) }, ctx);

describe("get_my_patterns", () => {
  it("sin datos dice qué falta en vez de inventar", async () => {
    const out = JSON.parse((await call(ctxWith([]))).content);
    expect(out.ok).toBe(true);
    expect(out.timeEstimates.overall.learned).toBe(false);
    expect(out.timeEstimates.measuredNeeded).toBe(5);
    expect(out.productiveHours).toMatchObject({ learned: false, needed: 15, bestPart: null });
  });

  it("devuelve los números calculados por código: factor, minutos para 30 y franja", async () => {
    const out = JSON.parse((await call(ctxWith(many(16)))).content);
    expect(out.timeEstimates.overall).toMatchObject({ factor: 1.5, learned: true, minutesFor30Estimated: 45 });
    expect(out.timeEstimates.categories[0]).toMatchObject({ category: "study", factor: 1.5, source: "category" });
    expect(out.productiveHours).toMatchObject({ learned: true, bestPart: "morning" });
  });

  it("filtra por categoría y avisa si esa categoría no tiene mediciones", async () => {
    const ctx = ctxWith([...many(6), ...many(6, { category: "home", actualMin: 30 })]);
    const studyOnly = JSON.parse((await call(ctx, { category: "Study" })).content);
    expect(studyOnly.timeEstimates.categories.map((c: { category: string }) => c.category)).toEqual(["study"]);
    const none = JSON.parse((await call(ctx, { category: "sport" })).content);
    expect(none.timeEstimates.categories).toEqual([]);
    expect(none.timeEstimates.categoryNote).toMatch(/general/);
  });

  it("no acepta un userId por argumento: lee lo que el contexto ya trae", async () => {
    const ctx = ctxWith(many(6));
    await call(ctx, { userId: "otro_usuario" });
    expect(ctx.read).toHaveBeenCalledWith();
  });

  it("es de solo lectura: no cierra el turno ni escribe nada", async () => {
    const out = await call(ctxWith(many(6)));
    expect(out.effect).toBeUndefined();
    expect(out.isError).toBeUndefined();
  });

  it("falla con gracia si no hay patrones en el contexto", async () => {
    const out = await executeTool({ id: "c", name: "get_my_patterns", arguments: "{}" }, { today: "2026-09-28", now: new Date(), load: vi.fn() } as never);
    expect(out.isError).toBe(true);
  });
});

describe("plan_week con factor por categoría", () => {
  const plan = (inflationByCategory?: Record<string, number>, category = "study") =>
    planWeek({
      today: "2026-09-28",
      weekStart: "2026-09-28",
      availability: DEFAULT_AVAILABILITY,
      items: [{ title: "Estudiar", kind: "task", estimateMin: 60, priority: "medium", category }],
      inflation: 1,
      inflationByCategory
    });
  const minutes = (p: ReturnType<typeof plan>) => p.days.reduce((sum, d) => sum + d.plannedMin, 0);

  it("usa el de su categoría y, sin él, el general", () => {
    expect(minutes(plan({ study: 1.5 }))).toBe(90);
    expect(minutes(plan({ home: 2 }))).toBe(60);
    expect(minutes(plan(undefined))).toBe(60);
  });

  it("no distingue mayúsculas ni espacios en la categoría", () => {
    expect(minutes(plan({ study: 1.5 }, " Study "))).toBe(90);
  });
});

describe("el scheduler de proyectos usa el factor de la categoría", () => {
  const project = (inflation?: number) => ({
    id: "p", deadline: "2026-10-30",
    ...(inflation !== undefined ? { inflation } : {}),
    subtasks: [{ id: "s", estimateMin: 60, dependsOn: [], done: false }]
  });
  const total = (inflation?: number) =>
    planProjects({
      today: "2026-09-28", availability: DEFAULT_AVAILABILITY, overrides: {}, tasks: [], previousSessions: [],
      projects: [project(inflation)], inflation: 1.3
    }).sessions.reduce((sum, s) => sum + s.minutes, 0);

  it("un proyecto con su propio factor se agenda con él; sin factor, con el del plan", () => {
    expect(total(1.5)).toBe(90);
    expect(total(1)).toBe(60);
    expect(total(undefined)).toBe(78);
  });
});
