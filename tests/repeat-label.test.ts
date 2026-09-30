import { describe, expect, it } from "vitest";
import type { RepeatSpec } from "@/types/task";
import { copy } from "@/lib/i18n";
import { describeRepeat, weekdayShortName } from "@/lib/repeat-label";

const en = copy.en.taskForm;
const es = copy.es.taskForm;
type FormCopy = {
  repeatOptions: { daily: string; monthly: string };
  repeatEvery: string;
  repeatWeeks: string;
  repeatDays: string;
  repeatMonths: string;
};
const labels = (t: FormCopy) => ({
  repeatOptions: t.repeatOptions,
  repeatEvery: t.repeatEvery,
  repeatWeeks: t.repeatWeeks,
  repeatDays: t.repeatDays,
  repeatMonths: t.repeatMonths
});

describe("describeRepeat", () => {
  it("diario", () => {
    expect(describeRepeat({ freq: "daily", interval: 1 }, "en", labels(en))).toBe("Every day");
    expect(describeRepeat({ freq: "daily", interval: 3 }, "en", labels(en))).toBe("Every 3 days");
  });

  it("semanal con días, en el idioma de la app", () => {
    const rule: RepeatSpec = { freq: "weekly", interval: 1, weekdays: [3, 6] };
    expect(describeRepeat(rule, "en", labels(en))).toBe("Wed, Sat");
    expect(describeRepeat(rule, "es", labels(es))).toBe("mié, sáb");
  });

  it("cada N semanas incluye los días", () => {
    expect(
      describeRepeat({ freq: "weekly", interval: 2, weekdays: [1] }, "en", labels(en))
    ).toBe("Every 2 weeks · Mon");
  });

  it("semanal sin weekdays usa el día de la fecha de inicio", () => {
    // 2026-09-30 es miércoles.
    expect(describeRepeat({ freq: "weekly", interval: 1 }, "en", labels(en), "2026-09-30")).toBe("Wed");
  });

  it("mensual", () => {
    expect(describeRepeat({ freq: "monthly", interval: 1, monthDay: 5 }, "en", labels(en))).toBe("Every month · 5");
    expect(describeRepeat({ freq: "monthly", interval: 2 }, "en", labels(en))).toBe("Every 2 months");
  });
});

describe("weekdayShortName", () => {
  it("0 es domingo", () => {
    expect(weekdayShortName(0, "en")).toBe("Sun");
    expect(weekdayShortName(6, "en")).toBe("Sat");
  });
});
