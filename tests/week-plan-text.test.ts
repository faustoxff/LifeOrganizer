import { describe, expect, it } from "vitest";
import { copy, supportedLanguages } from "@/lib/i18n";
import {
  dayLabel,
  describeDeferred,
  describeReason,
  describeWarning,
  formatMinutes,
  weekdayName
} from "@/lib/week-plan-text";
import type { Reason } from "@/lib/week-planner";

describe("formatMinutes", () => {
  it("minutos, horas y mixto", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(-5)).toBe("0 min");
    expect(formatMinutes(59.6)).toBe("1 h");
  });
});

describe("días", () => {
  it("el día de la semana sale del propio YYYY-MM-DD, sin zona horaria", () => {
    expect(weekdayName("2026-09-28", "es")).toBe("lunes");
    expect(weekdayName("2026-09-28", "en")).toBe("Monday");
    expect(weekdayName("2026-10-04", "es")).toBe("domingo");
  });

  it("la etiqueta corta trae día y fecha", () => {
    expect(dayLabel("2026-09-28", "en")).toMatch(/Mon.*28/);
    expect(dayLabel("2026-09-28", "es")).toMatch(/lun.*28/);
  });
});

describe("razones", () => {
  const cases: Array<[Reason, RegExp]> = [
    [{ code: "FIXED", date: "2026-09-29" }, /Fecha fija/],
    [{ code: "RECURRING", dates: ["2026-09-30", "2026-10-03"] }, /Se repite miércoles, sábado/],
    [{ code: "DEADLINE", date: "2026-09-29", deadline: "2026-09-29" }, /Tiene que estar para el/],
    [{ code: "BEST_FIT", date: "2026-09-29", minutes: 0 }, /más lugar/],
    [{ code: "FULL", date: "2026-09-28", minutes: 120, title: "TP" }, /lunes ya está lleno \(2 h\)/],
    [{ code: "HEAVY_CLASH", date: "2026-10-03", minutes: 90, title: "TP de álgebra" }, /sábado ya tiene algo pesado \(TP de álgebra\)/],
    [{ code: "OVER_CAP", date: "2026-09-28", minutes: 80 }, /lunes pasaría del 85 % \(1 h 20 min/],
    [{ code: "KEEP_LIGHT", date: "2026-10-04" }, /dejar domingo liviano/],
    [{ code: "BUSIER", date: "2026-09-28", minutes: 60 }, /lunes está más cargado \(1 h/]
  ];

  it.each(cases)("%j", (reason, pattern) => {
    expect(describeReason(reason, "es")).toMatch(pattern);
  });

  it("HEAVY_CLASH sin título no deja paréntesis vacíos", () => {
    expect(describeReason({ code: "HEAVY_CLASH", date: "2026-10-03" }, "es")).not.toContain("()");
  });

  it("todas las razones tienen texto en los 13 idiomas y nombran el día descartado", () => {
    for (const language of supportedLanguages) {
      for (const [reason] of cases) {
        const text = describeReason(reason, language);
        expect(text.trim().length, `${language} ${reason.code}`).toBeGreaterThan(0);
        if (["FULL", "HEAVY_CLASH", "OVER_CAP", "KEEP_LIGHT", "BUSIER"].includes(reason.code)) {
          expect(text, `${language} ${reason.code}`).toContain(weekdayName(reason.date!, language));
        }
      }
    }
  });
});

describe("diferidos y avisos", () => {
  const deferred = { title: "Tesis", estimateMin: 300, priority: "low" as const, neededMin: 300, freeMin: 180, suggestedDate: "2026-10-05" };

  it("cada causa dice qué pasó y, salvo NO_DAY, a dónde pasarlo", () => {
    expect(describeDeferred({ ...deferred, code: "NO_ROOM" }, "es")).toMatch(/Necesita 5 h y solo quedan 3 h\. Sugerencia: pasarlo al/);
    expect(describeDeferred({ ...deferred, code: "TOO_BIG" }, "es")).toMatch(/más de lo que cabe en un día \(3 h\)/);
    expect(describeDeferred({ ...deferred, code: "NO_DAY" }, "es")).toBe("No hay un día disponible antes de su fecha límite");
  });

  it("avisos", () => {
    expect(describeWarning({ code: "OVERBOOKED_DAY", date: "2026-09-29", loadMin: 220, capacityMin: 120 }, "es")).toMatch(/supera tu tiempo/);
    expect(describeWarning({ code: "NO_LIGHT_DAY" }, "es")).toMatch(/ningún día liviano/);
    expect(describeWarning({ code: "DEADLINE_AT_RISK", title: "Tesis", deadline: "2026-10-02" }, "es")).toContain('"Tesis"');
  });

  it("los 13 idiomas traen los textos y los que llevan parámetro lo usan", () => {
    for (const language of supportedLanguages) {
      const t = copy[language].weekPlan;
      for (const key of ["title", "created", "lightDay", "offDay", "deferredTitle", "deferredNoDay", "outsideTitle", "warnNoLightDay"] as const) {
        expect(typeof t[key], `${language}.weekPlan.${key}`).toBe("string");
        expect((t[key] as string).trim().length).toBeGreaterThan(0);
      }
      expect(t.createAll(7), language).toContain("7");
      expect(t.loadOf("USED", "CAP"), language).toMatch(/USED.*CAP/);
      expect(t.deferredMove("DATE"), language).toContain("DATE");
      expect(t.deferredNoRoom("NEED", "FREE"), language).toMatch(/NEED.*FREE|FREE.*NEED/);
      expect(t.deferredTooBig("NEED", "MAX"), language).toMatch(/NEED.*MAX/);
      expect(t.warnOverbooked("DAY"), language).toContain("DAY");
      expect(t.warnDeadline("TITLE"), language).toContain("TITLE");
      expect(t.reasons.recurring("DAYS"), language).toContain("DAYS");
      expect(t.reasons.deadline("DATE"), language).toContain("DATE");
      expect(t.reasons.full("OTHER", "TIME"), language).toMatch(/OTHER/);
      expect(t.reasons.full("OTHER", "TIME"), language).toMatch(/TIME/);
      expect(t.reasons.heavyClash("OTHER", "TITLE"), language).toContain("TITLE");
      expect(t.reasons.heavyClash("OTHER", ""), language).not.toMatch(/\(\)|（）/);
      expect(t.reasons.overCap("OTHER", "TIME"), language).toContain("TIME");
      expect(t.reasons.keepLight("OTHER"), language).toContain("OTHER");
      expect(t.reasons.busier("OTHER", "TIME"), language).toContain("TIME");
    }
  });
});
