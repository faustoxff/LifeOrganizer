import { describe, expect, it } from "vitest";
import { getTopScoredTask, getTaskScore } from "@/lib/task-score";
import type { Task } from "@/types/task";

function dateIn(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: overrides.id,
    category: "general",
    description: "",
    priority: "medium",
    estimateMin: 45,
    kind: "task",
    status: "pending",
    dueDate: dateIn(5),
    done: false,
    ...overrides
  };
}

describe("getTaskScore", () => {
  it("scores an overdue task above the same task due next week", () => {
    const overdue = task({ id: "a", dueDate: dateIn(-1) });
    const later = task({ id: "b", dueDate: dateIn(7) });
    expect(getTaskScore(overdue)).toBeGreaterThan(getTaskScore(later));
  });

  it("scores high priority above low priority, all else equal", () => {
    expect(getTaskScore(task({ id: "a", priority: "high" })))
      .toBeGreaterThan(getTaskScore(task({ id: "b", priority: "low" })));
  });

  it("gives a long task due soon more weight than a short one", () => {
    const long = task({ id: "a", estimateMin: 120, dueDate: dateIn(2) });
    const short = task({ id: "b", estimateMin: 15, dueDate: dateIn(2) });
    expect(getTaskScore(long)).toBeGreaterThan(getTaskScore(short));
  });
});

describe("getTopScoredTask", () => {
  it("returns null when there is nothing pending", () => {
    expect(getTopScoredTask([])).toBeNull();
    expect(getTopScoredTask([task({ id: "a", done: true })])).toBeNull();
  });

  it("ignores completed tasks even when they would score highest", () => {
    const done = task({ id: "done", done: true, priority: "high", dueDate: dateIn(-3) });
    const pending = task({ id: "pending", priority: "low", dueDate: dateIn(9) });
    expect(getTopScoredTask([done, pending])?.id).toBe("pending");
  });

  it("picks the urgent high-priority task over a far-off one", () => {
    const urgent = task({ id: "urgent", priority: "high", dueDate: dateIn(1) });
    const later = task({ id: "later", priority: "low", dueDate: dateIn(20) });
    expect(getTopScoredTask([later, urgent])?.id).toBe("urgent");
  });

  it("is deterministic: same input, same winner regardless of order", () => {
    const tasks = [
      task({ id: "a", priority: "high", dueDate: dateIn(3), estimateMin: 120 }),
      task({ id: "b", priority: "medium", dueDate: dateIn(1), estimateMin: 15 }),
      task({ id: "c", priority: "low", dueDate: dateIn(0), estimateMin: 45 })
    ];
    const winner = getTopScoredTask(tasks)?.id;
    expect(getTopScoredTask([...tasks].reverse())?.id).toBe(winner);
  });
});

describe("minutos", () => {
  it("una tarea más larga pesa más cuando se acerca la fecha", () => {
    const quick = task({ id: "a", estimateMin: 15, dueDate: dateIn(2) });
    const hours = task({ id: "b", estimateMin: 150, dueDate: dateIn(2) });
    expect(getTaskScore(hours)).toBeGreaterThan(getTaskScore(quick));
  });

  it("los cortes coinciden con los de la columna derivada (<=20, <=75)", () => {
    const at = (m: number) => getTaskScore(task({ id: "x", estimateMin: m, dueDate: dateIn(10) }));
    expect(at(20)).toBe(at(15));
    expect(at(21)).toBe(at(75));
    expect(at(76)).toBe(at(120));
    expect(at(76)).not.toBe(at(75));
  });

  it("acepta un `today` explícito, para el servidor", () => {
    const t = task({ id: "a", dueDate: "2026-10-01" });
    expect(getTaskScore(t, "2026-10-01")).toBeGreaterThan(getTaskScore(t, "2026-09-01"));
  });
});

describe("getTopScoredTask: qué compite", () => {
  const TODAY = "2026-09-28";

  it("un recordatorio no es la tarea recomendada, aunque puntúe más", () => {
    const reminder = task({ id: "rem", kind: "reminder", priority: "high", dueDate: TODAY, estimateMin: 5 });
    const normal = task({ id: "norm", priority: "low", dueDate: "2026-10-20" });
    expect(getTopScoredTask([reminder, normal], TODAY)?.id).toBe("norm");
    expect(getTopScoredTask([reminder], TODAY)).toBeNull();
  });

  it("una ocurrencia salteada no compite", () => {
    const skipped = task({ id: "s", status: "skipped", seriesId: "g", occurrenceDate: "2026-09-27", dueDate: "2026-09-27", priority: "high" });
    const normal = task({ id: "norm", priority: "low", dueDate: "2026-10-20" });
    expect(getTopScoredTask([skipped, normal], TODAY)?.id).toBe("norm");
  });

  it("una ocurrencia futura de una serie no compite hoy; la de hoy sí", () => {
    const future = task({ id: "f", seriesId: "g", occurrenceDate: "2026-09-30", dueDate: "2026-09-30", priority: "high" });
    const today = task({ id: "t", seriesId: "g", occurrenceDate: TODAY, dueDate: TODAY, priority: "low" });
    expect(getTopScoredTask([future, today], TODAY)?.id).toBe("t");
    expect(getTopScoredTask([future], TODAY)).toBeNull();
  });

  it("una tarea suelta con fecha futura sigue compitiendo, como siempre", () => {
    const later = task({ id: "later", dueDate: "2026-10-30" });
    expect(getTopScoredTask([later], TODAY)?.id).toBe("later");
  });
});
