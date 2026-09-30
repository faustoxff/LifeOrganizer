import { describe, expect, it } from "vitest";
import {
  formatDueDate,
  getDaysUntilDueDate,
  getDueDateLabel,
  getTodayDateValue,
  getTodayInTimeZone,
  isValidTimeZone
} from "@/lib/task-date";

function dateIn(days: number) {
  // Local calendar days, not UTC. `toISOString()` rolls over to the next day for
  // anyone west of Greenwich after their evening, so in Argentina this helper
  // returned tomorrow's date and the assertions failed from 21:00 on.
  const d = new Date();
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("getDaysUntilDueDate", () => {
  it("counts today as 0 and handles past and future", () => {
    expect(getDaysUntilDueDate(dateIn(0))).toBe(0);
    expect(getDaysUntilDueDate(dateIn(3))).toBe(3);
    expect(getDaysUntilDueDate(dateIn(-2))).toBe(-2);
  });

  it("does not drift across a daylight-saving boundary", () => {
    // Rounding (not flooring) keeps 23h and 25h days at whole numbers.
    for (let i = 1; i <= 60; i++) {
      expect(getDaysUntilDueDate(dateIn(i))).toBe(i);
    }
  });
});

describe("getDueDateLabel", () => {
  it("uses the Spanish wording for past, today and tomorrow", () => {
    expect(getDueDateLabel(dateIn(-1), "es")).toBe("vencida");
    expect(getDueDateLabel(dateIn(0), "es")).toBe("vence hoy");
    expect(getDueDateLabel(dateIn(1), "es")).toBe("vence mañana");
  });

  it("returns a non-empty label in every supported language", () => {
    for (const lang of ["en", "es", "pt", "fr", "de", "it", "zh", "ja", "ko", "ru", "tr", "nl", "pl"] as const) {
      expect(getDueDateLabel(dateIn(2), lang).length).toBeGreaterThan(0);
    }
  });
});

describe("formatDueDate", () => {
  it("formats a date without shifting the day", () => {
    expect(formatDueDate("2026-01-15", "es")).toContain("15");
    expect(formatDueDate("2026-01-15", "en")).toContain("15");
  });
});

describe("getTodayDateValue", () => {
  it("returns an ISO day usable by <input type=date>", () => {
    expect(getTodayDateValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getTodayInTimeZone", () => {
  // 2026-09-29 01:30 UTC: ya es martes en UTC, pero todavía lunes en Buenos Aires.
  const NIGHT = new Date("2026-09-29T01:30:00.000Z");

  it("da el día de calendario de la zona pedida, no el de UTC", () => {
    expect(getTodayInTimeZone("UTC", NIGHT)).toBe("2026-09-29");
    expect(getTodayInTimeZone("America/Argentina/Buenos_Aires", NIGHT)).toBe("2026-09-28");
    expect(getTodayInTimeZone("Asia/Tokyo", NIGHT)).toBe("2026-09-29");
    expect(getTodayInTimeZone("Pacific/Kiritimati", NIGHT)).toBe("2026-09-29");
  });

  it("una zona inválida cae en UTC en vez de lanzar", () => {
    expect(getTodayInTimeZone("Not/AZone", NIGHT)).toBe("2026-09-29");
  });
});

describe("isValidTimeZone", () => {
  it("acepta zonas IANA y rechaza el resto", () => {
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone("x".repeat(100))).toBe(false);
  });
});
