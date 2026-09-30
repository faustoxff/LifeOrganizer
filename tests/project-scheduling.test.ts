import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import {
  addExtraMinutes,
  computeFixedLoad,
  draftProject,
  DRAFT_PROJECT_ID,
  groupByDay,
  planProjects,
  progressOf,
  schedulerProjectFrom,
  totalHours,
  unprefixDraftSessions
} from "@/lib/project-scheduling";
import { schedule } from "@/lib/scheduler";
import type { PlannedSubtask, ProjectSubtask } from "@/types/project";
import type { Task } from "@/types/task";

const TODAY = "2026-09-28"; // lunes

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: over.id, category: "general", description: "", priority: "medium", estimateMin: 45,
  dueDate: TODAY, done: false, status: "pending", kind: "task", ...over
});
const planned = (tempId: string, estimateMin: number, dependsOn: string[] = []): PlannedSubtask => ({
  tempId, title: `Hacer ${tempId}`, estimateMin, dependsOn, deliverable: false
});
const stored = (id: string, over: Partial<ProjectSubtask> = {}): ProjectSubtask => ({
  id, projectId: "P", title: id, estimateMin: 60, dependsOn: [], position: 0, done: false, deliverable: false, ...over
});

describe("computeFixedLoad", () => {
  it("suma las tareas pendientes en su fecha", () => {
    const load = computeFixedLoad(
      [task({ id: "a", dueDate: "2026-09-30", estimateMin: 45 }), task({ id: "b", dueDate: "2026-09-30", estimateMin: 30 }), task({ id: "c", dueDate: "2026-10-02", estimateMin: 60 })],
      TODAY
    );
    expect(load).toEqual({ "2026-09-30": 75, "2026-10-02": 60 });
  });

  it("lo vencido cuenta hoy", () => {
    expect(computeFixedLoad([task({ id: "a", dueDate: "2026-09-20", estimateMin: 45 })], TODAY)).toEqual({ [TODAY]: 45 });
  });

  it("no cuenta lo hecho, lo salteado ni los proyectos", () => {
    const load = computeFixedLoad([
      task({ id: "hecha", done: true, status: "done" }),
      task({ id: "salteada", status: "skipped", seriesId: "s" }),
      task({ id: "proyecto", kind: "project", estimateMin: 120 })
    ], TODAY);
    expect(load).toEqual({});
  });

  it("los recordatorios cuentan sus minutos, que son pocos", () => {
    expect(computeFixedLoad([task({ id: "r", kind: "reminder", estimateMin: 5 })], TODAY)).toEqual({ [TODAY]: 5 });
  });
});

describe("schedulerProjectFrom", () => {
  it("ordena por posición y pasa lo que el scheduler necesita", () => {
    const project = schedulerProjectFrom(
      { id: "P", dueDate: "2026-10-12", dailyCapMin: 45 },
      [stored("b", { position: 1, notBefore: "2026-09-30" }), stored("a", { position: 0, actualMin: 20 })]
    );
    expect(project).toMatchObject({ id: "P", deadline: "2026-10-12", dailyCapMin: 45 });
    expect(project.subtasks.map((s) => s.id)).toEqual(["a", "b"]);
    expect(project.subtasks[0]).toMatchObject({ actualMin: 20 });
    expect(project.subtasks[1]).toMatchObject({ notBefore: "2026-09-30" });
    expect(project.subtasks[0]).not.toHaveProperty("notBefore");
  });
});

describe("planProjects", () => {
  const ctx = (projects: ReturnType<typeof draftProject>[], over = {}) => ({
    today: TODAY, availability: DEFAULT_AVAILABILITY, overrides: {}, tasks: [] as Task[], projects, previousSessions: [], inflation: 1, ...over
  });

  it("planifica un borrador con las estimaciones de la IA y devuelve sesiones con tempIds", () => {
    const draft = draftProject("2026-10-12", null, [planned("t1", 30), planned("t2", 60, ["t1"]), planned("t3", 60, ["t2"]), planned("t4", 30, ["t3"])]);
    const out = planProjects(ctx([draft]));
    expect(out.perProject[DRAFT_PROJECT_ID].feasible).toBe(true);
    const sessions = unprefixDraftSessions(out.sessions);
    expect(sessions.map((s) => s.subtaskId)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(sessions.every((s) => s.projectId === DRAFT_PROJECT_ID)).toBe(true);
    // en cadena: un día cada una
    expect(new Set(sessions.map((s) => s.date)).size).toBe(4);
  });

  it("la carga fija de las tareas normales le quita lugar al proyecto", () => {
    const draft = draftProject("2026-10-12", null, [planned("t1", 60), planned("t2", 60)]);
    const busy = planProjects(ctx([draft], { tasks: [task({ id: "x", dueDate: TODAY, estimateMin: 120 })] }));
    expect(busy.sessions.filter((s) => s.date === TODAY)).toEqual([]);
    const free = planProjects(ctx([draft]));
    expect(free.sessions.filter((s) => s.date === TODAY).length).toBeGreaterThan(0);
  });

  it("un proyecto nuevo no mueve lo que ya estaba agendado", () => {
    const existing = schedulerProjectFrom({ id: "P", dueDate: "2026-10-16" }, [stored("s1", { estimateMin: 60 }), stored("s2", { estimateMin: 60, position: 1 })]);
    const before = planProjects(ctx([existing]));
    const draft = draftProject("2026-10-30", null, [planned("t1", 30), planned("t2", 30), planned("t3", 30), planned("t4", 30)]);
    const after = planProjects(ctx([existing, draft], { previousSessions: before.sessions }));
    for (const s of before.sessions) {
      expect(after.sessions).toContainEqual(expect.objectContaining({ subtaskId: s.subtaskId, date: s.date, minutes: s.minutes }));
    }
  });

  it("usa la inflación pedida", () => {
    const draft = draftProject("2026-10-30", null, [planned("t1", 60), planned("t2", 60), planned("t3", 60), planned("t4", 60)]);
    const total = (inflation: number) => planProjects(ctx([draft], { inflation })).sessions.reduce((n, s) => n + s.minutes, 0);
    expect(total(1)).toBe(240);
    expect(total(1.5)).toBe(360);
  });
});

describe("addExtraMinutes", () => {
  it("suma a los días con disponibilidad y deja en 0 los que están en 0", () => {
    const out = addExtraMinutes({ ...DEFAULT_AVAILABILITY, "0": 0 }, { "2026-10-02": 0, "2026-10-03": 60 }, 20);
    expect(out.availability).toEqual({ "0": 0, "1": 140, "2": 140, "3": 140, "4": 140, "5": 140, "6": 200 });
    expect(out.overrides).toEqual({ "2026-10-02": 0, "2026-10-03": 80 });
  });

  it("nunca pasa de 24 horas", () => {
    expect(addExtraMinutes({ ...DEFAULT_AVAILABILITY, "1": 1430 }, {}, 60).availability["1"]).toBe(1440);
  });

  it("aplicar la opción del scheduler hace que el proyecto entre de verdad", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, estimateMin: 60, dependsOn: [], done: false }));
    const input = { today: TODAY, availability: DEFAULT_AVAILABILITY, projects: [{ id: "p", deadline: "2026-09-30", subtasks: seven }], params: { inflation: 1 } };
    const before = schedule(input);
    expect(before.perProject.p.feasible).toBe(false);
    const extra = before.perProject.p.options!.extraMinPerDay!;
    const boosted = addExtraMinutes(DEFAULT_AVAILABILITY, {}, extra);
    expect(schedule({ ...input, availability: boosted.availability }).perProject.p.feasible).toBe(true);
  });
});

describe("helpers de vista", () => {
  it("groupByDay agrupa y ordena", () => {
    const groups = groupByDay([
      { date: "2026-10-01", minutes: 30, id: "a" }, { date: "2026-09-29", minutes: 60, id: "b" }, { date: "2026-10-01", minutes: 45, id: "c" }
    ]);
    expect(groups.map((g) => [g.date, g.minutes, g.items.length])).toEqual([["2026-09-29", 60, 1], ["2026-10-01", 75, 2]]);
  });

  it("progressOf y totalHours", () => {
    expect(progressOf([{ done: true }, { done: false }, { done: true }])).toEqual({ done: 2, total: 3 });
    expect(progressOf([])).toEqual({ done: 0, total: 0 });
    expect(totalHours(390)).toBe(6.5);
    expect(totalHours(20)).toBe(0.3);
  });
});
