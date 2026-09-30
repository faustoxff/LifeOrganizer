import { describe, expect, it } from "vitest";
import {
  getSkippedDates,
  getTodayReminders,
  isFutureOccurrence,
  isRecommendable,
  isVisibleInToday
} from "@/lib/task-views";
import type { Task } from "@/types/task";

const TODAY = "2026-09-28";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id, category: "general", description: "", priority: "medium",
    estimateMin: 45, dueDate: TODAY, done: false, status: "pending", kind: "task", ...over
  };
}

describe("isVisibleInToday", () => {
  it("una tarea pendiente suelta se ve, sea de hoy, vencida o futura", () => {
    expect(isVisibleInToday(task({ id: "a", dueDate: TODAY }), TODAY)).toBe(true);
    expect(isVisibleInToday(task({ id: "b", dueDate: "2026-09-01" }), TODAY)).toBe(true);
    expect(isVisibleInToday(task({ id: "c", dueDate: "2026-12-01" }), TODAY)).toBe(true);
  });

  it("lo hecho y lo salteado no se ven", () => {
    expect(isVisibleInToday(task({ id: "a", done: true, status: "done" }), TODAY)).toBe(false);
    expect(isVisibleInToday(task({ id: "b", status: "skipped", seriesId: "s", dueDate: "2026-09-20" }), TODAY)).toBe(false);
  });

  it("una ocurrencia futura no se ve en Hoy; la de hoy sí", () => {
    expect(isVisibleInToday(task({ id: "a", seriesId: "s", dueDate: "2026-09-30" }), TODAY)).toBe(false);
    expect(isVisibleInToday(task({ id: "b", seriesId: "s", dueDate: TODAY }), TODAY)).toBe(true);
  });
});

describe("isFutureOccurrence", () => {
  it("solo aplica a filas de una serie", () => {
    expect(isFutureOccurrence({ seriesId: "s", dueDate: "2026-09-30" }, TODAY)).toBe(true);
    expect(isFutureOccurrence({ dueDate: "2026-09-30" }, TODAY)).toBe(false);
    expect(isFutureOccurrence({ seriesId: "s", dueDate: TODAY }, TODAY)).toBe(false);
  });
});

describe("isRecommendable", () => {
  it("un recordatorio no compite", () => {
    expect(isRecommendable(task({ id: "a", kind: "reminder" }), TODAY)).toBe(false);
    expect(isRecommendable(task({ id: "b", kind: "task" }), TODAY)).toBe(true);
    expect(isRecommendable(task({ id: "c", kind: "project" }), TODAY)).toBe(true);
  });
});

describe("getTodayReminders", () => {
  it("junta los recordatorios de hoy y vencidos, ordenados por fecha y hora", () => {
    const list = getTodayReminders(
      [
        task({ id: "tarde", kind: "reminder", time: "18:00" }),
        task({ id: "temprano", kind: "reminder", time: "08:00" }),
        task({ id: "ayer", kind: "reminder", dueDate: "2026-09-27", time: "23:00" }),
        task({ id: "sinhora", kind: "reminder" }),
        task({ id: "manana", kind: "reminder", dueDate: "2026-09-29", time: "07:00" }),
        task({ id: "hecho", kind: "reminder", done: true, status: "done" }),
        task({ id: "salteado", kind: "reminder", status: "skipped", seriesId: "s", dueDate: "2026-09-26" }),
        task({ id: "futuraSerie", kind: "reminder", seriesId: "s", dueDate: "2026-09-30" }),
        task({ id: "tarea", kind: "task", time: "09:00" })
      ],
      TODAY
    ).map((t) => t.id);
    expect(list).toEqual(["ayer", "temprano", "tarde", "sinhora"]);
  });
});

describe("getSkippedDates", () => {
  it("devuelve las fechas de las ocurrencias salteadas, sin repetir", () => {
    const dates = getSkippedDates([
      task({ id: "a", status: "skipped", occurrenceDate: "2026-09-20" }),
      task({ id: "b", status: "skipped", occurrenceDate: "2026-09-20" }),
      task({ id: "c", status: "skipped", occurrenceDate: "2026-09-22" }),
      task({ id: "d", status: "pending", occurrenceDate: "2026-09-24" }),
      task({ id: "e", status: "skipped" })
    ]);
    expect(dates.sort()).toEqual(["2026-09-20", "2026-09-22"]);
  });
});
