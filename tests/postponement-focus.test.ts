import { describe, expect, it } from "vitest";
import { canFocusTask, FOCUS_MAX_QUICK_MIN } from "@/lib/focus-eligibility";
import { isPostponement, postponementIncrement } from "@/lib/postponement";
import { getHourInTimeZone } from "@/lib/task-date";

describe("isPostponement", () => {
  it("pasar a un día posterior es postergar", () => {
    expect(isPostponement("2026-09-29", "2026-09-30")).toBe(true);
    expect(isPostponement("2026-09-29", "2027-01-01")).toBe(true);
    expect(postponementIncrement("2026-09-29", "2026-10-01")).toBe(1);
  });

  it("adelantar o dejar el mismo día no lo es", () => {
    expect(isPostponement("2026-09-29", "2026-09-28")).toBe(false);
    expect(isPostponement("2026-09-29", "2026-09-29")).toBe(false);
    expect(postponementIncrement("2026-09-29", "2026-09-29")).toBe(0);
  });

  it("fechas mal formadas no cuentan", () => {
    expect(isPostponement("", "2026-09-30")).toBe(false);
    expect(isPostponement("2026-09-29", "mañana")).toBe(false);
  });
});

describe("modo foco", () => {
  const task = (kind: "task" | "reminder" | "project", estimateMin: number, done = false) => ({ kind, estimateMin, done });

  it("se ofrece en tareas de más de 15 minutos", () => {
    expect(canFocusTask(task("task", FOCUS_MAX_QUICK_MIN + 1))).toBe(true);
    expect(canFocusTask(task("task", 45))).toBe(true);
  });

  it("no en tareas de 15 minutos o menos", () => {
    expect(canFocusTask(task("task", 15))).toBe(false);
    expect(canFocusTask(task("task", 5))).toBe(false);
  });

  it("nunca en recordatorios, sin importar el estimado", () => {
    expect(canFocusTask(task("reminder", 60))).toBe(false);
    expect(canFocusTask(task("reminder", 5))).toBe(false);
  });

  it("no en proyectos (se trabajan por sus sesiones) ni en tareas ya hechas", () => {
    expect(canFocusTask(task("project", 600))).toBe(false);
    expect(canFocusTask(task("task", 45, true))).toBe(false);
  });
});

describe("getHourInTimeZone", () => {
  // 2026-09-30 01:30 UTC
  const instant = new Date("2026-09-30T01:30:00Z");

  it("usa la zona del usuario, no la del servidor", () => {
    expect(getHourInTimeZone("UTC", instant)).toBe(1);
    expect(getHourInTimeZone("America/Argentina/Buenos_Aires", instant)).toBe(22); // UTC-3, día anterior
    expect(getHourInTimeZone("Asia/Tokyo", instant)).toBe(10);
  });

  it("medianoche es 0, no 24", () => {
    expect(getHourInTimeZone("UTC", new Date("2026-09-30T00:05:00Z"))).toBe(0);
  });

  it("una zona inválida cae a UTC", () => {
    expect(getHourInTimeZone("Nope/Nowhere", instant)).toBe(1);
  });
});
