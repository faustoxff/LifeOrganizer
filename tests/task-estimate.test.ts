import { describe, expect, it } from "vitest";
import {
  clampEstimate,
  durationFromMinutes,
  ESTIMATE_OPTIONS_MIN,
  formatMinutes,
  isValidEstimate,
  minutesFromDuration
} from "@/lib/task-estimate";

describe("durationFromMinutes", () => {
  it("<=20 short, <=75 medium, el resto long", () => {
    expect(durationFromMinutes(1)).toBe("short");
    expect(durationFromMinutes(20)).toBe("short");
    expect(durationFromMinutes(21)).toBe("medium");
    expect(durationFromMinutes(75)).toBe("medium");
    expect(durationFromMinutes(76)).toBe("long");
    expect(durationFromMinutes(600)).toBe("long");
  });

  it("es consistente con el backfill de la migración (15/45/120)", () => {
    for (const duration of ["short", "medium", "long"] as const) {
      expect(durationFromMinutes(minutesFromDuration(duration))).toBe(duration);
    }
  });

  it("cada opción del formulario cae en un bucket sensato", () => {
    expect(ESTIMATE_OPTIONS_MIN.map(durationFromMinutes)).toEqual([
      "short", "medium", "medium", "medium", "long", "long"
    ]);
  });
});

describe("isValidEstimate / clampEstimate", () => {
  it("acepta enteros de 1 minuto a 24 horas", () => {
    expect(isValidEstimate(1)).toBe(true);
    expect(isValidEstimate(1440)).toBe(true);
    expect(isValidEstimate(0)).toBe(false);
    expect(isValidEstimate(1441)).toBe(false);
    expect(isValidEstimate(12.5)).toBe(false);
    expect(isValidEstimate("30")).toBe(false);
  });

  it("clampEstimate nunca lanza y devuelve algo usable", () => {
    expect(clampEstimate(30)).toBe(30);
    expect(clampEstimate(0)).toBe(1);
    expect(clampEstimate(99999)).toBe(1440);
    expect(clampEstimate(NaN)).toBe(45);
    expect(clampEstimate(undefined)).toBe(45);
    expect(clampEstimate("x", 20)).toBe(20);
  });
});

describe("formatMinutes", () => {
  it("usa minutos y horas", () => {
    expect(formatMinutes(15)).toBe("15 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(90)).toBe("1 h 30");
    expect(formatMinutes(120)).toBe("2 h");
  });
});
