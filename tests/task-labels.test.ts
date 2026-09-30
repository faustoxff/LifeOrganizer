import { describe, expect, it } from "vitest";
import { getTaskDurationLabel, getTaskPriorityLabel } from "@/lib/task-labels";
import { supportedLanguages } from "@/lib/i18n";

describe("getTaskPriorityLabel", () => {
  it("translates instead of leaking the raw value", () => {
    expect(getTaskPriorityLabel("high", "es")).not.toBe("high");
    expect(getTaskPriorityLabel("high", "es").toLowerCase()).toBe("alta");
    expect(getTaskPriorityLabel("high", "en").toLowerCase()).toBe("high");
  });

  it("returns a distinct, non-empty label for every language and level", () => {
    for (const lang of supportedLanguages) {
      const labels = (["low", "medium", "high"] as const).map((p) => getTaskPriorityLabel(p, lang));
      expect(labels.every((l) => l.trim().length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(3);
    }
  });
});

describe("getTaskDurationLabel", () => {
  it("formats minutes the same way in every language", () => {
    expect(getTaskDurationLabel(15)).toBe("15 min");
    expect(getTaskDurationLabel(60)).toBe("1 h");
    expect(getTaskDurationLabel(90)).toBe("1 h 30");
  });
});
