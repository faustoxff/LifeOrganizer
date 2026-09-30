import { describe, expect, it } from "vitest";
import {
  bestStreakFromDayKeys,
  getStreakFromCompletions,
  getBadgeProgress,
  getCurrentBadge,
  getDaysToNextBadge,
  getEarnedBadges,
  getNextBadge,
  STREAK_BADGES
} from "@/lib/streak";

describe("STREAK_BADGES", () => {
  it("is strictly increasing in both days and level", () => {
    for (let i = 1; i < STREAK_BADGES.length; i++) {
      expect(STREAK_BADGES[i].days).toBeGreaterThan(STREAK_BADGES[i - 1].days);
      expect(STREAK_BADGES[i].level).toBe(STREAK_BADGES[i - 1].level + 1);
    }
  });
});

describe("getEarnedBadges", () => {
  it("gives nothing before the first day", () => {
    expect(getEarnedBadges(0)).toEqual([]);
    expect(getEarnedBadges(-5)).toEqual([]);
  });

  it("unlocks exactly on the milestone day", () => {
    for (const badge of STREAK_BADGES) {
      expect(getEarnedBadges(badge.days - 1).some((b) => b.level === badge.level)).toBe(false);
      expect(getEarnedBadges(badge.days).some((b) => b.level === badge.level)).toBe(true);
    }
  });

  it("never loses a badge as the streak grows", () => {
    let previous = 0;
    for (let d = 0; d <= 400; d++) {
      const count = getEarnedBadges(d).length;
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });
});

describe("getCurrentBadge / getNextBadge", () => {
  it("has no current badge and a first next badge at zero", () => {
    expect(getCurrentBadge(0)).toBeNull();
    expect(getNextBadge(0)?.days).toBe(1);
  });

  it("points at the following milestone mid-run", () => {
    expect(getCurrentBadge(10)?.days).toBe(7);
    expect(getNextBadge(10)?.days).toBe(14);
  });

  it("has no next badge once the last one is unlocked", () => {
    const last = STREAK_BADGES[STREAK_BADGES.length - 1];
    expect(getNextBadge(last.days)).toBeNull();
    expect(getDaysToNextBadge(last.days)).toBeNull();
    expect(getBadgeProgress(last.days)).toBe(1);
  });
});

describe("getDaysToNextBadge", () => {
  it("counts the days that are actually missing", () => {
    expect(getDaysToNextBadge(0)).toBe(1);
    expect(getDaysToNextBadge(8)).toBe(6);
    expect(getDaysToNextBadge(49)).toBe(1);
  });
});

describe("getBadgeProgress", () => {
  it("stays within 0 and 1 for any streak length", () => {
    for (let d = -5; d <= 400; d++) {
      const p = getBadgeProgress(d);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("restarts at each milestone and grows inside the span", () => {
    expect(getBadgeProgress(7)).toBe(0);
    expect(getBadgeProgress(10)).toBeGreaterThan(0);
    expect(getBadgeProgress(13)).toBeLessThan(1);
  });
});

describe("getStreakFromCompletions", () => {
  const dayAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };

  it("is zero with no completions", () => {
    expect(getStreakFromCompletions([])).toBe(0);
    expect(getStreakFromCompletions([undefined, ""])).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    expect(getStreakFromCompletions([dayAgo(0), dayAgo(1), dayAgo(2)])).toBe(3);
  });

  it("keeps the run alive when today has nothing yet", () => {
    expect(getStreakFromCompletions([dayAgo(1), dayAgo(2)])).toBe(2);
  });

  it("stops at the first missing day", () => {
    expect(getStreakFromCompletions([dayAgo(0), dayAgo(1), dayAgo(3), dayAgo(4)])).toBe(2);
  });

  it("is zero when the last completion is older than yesterday", () => {
    expect(getStreakFromCompletions([dayAgo(2), dayAgo(3)])).toBe(0);
  });

  it("counts a day once even with several tasks finished on it", () => {
    expect(getStreakFromCompletions([dayAgo(0), dayAgo(0), dayAgo(0), dayAgo(1)])).toBe(2);
  });
});

describe("racha con ocurrencias salteadas", () => {
  const key = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const at = (n: number) => `${key(n)}T12:00:00.000Z`;

  it("un día salteado en el medio no corta la racha", () => {
    // Hecho hoy, ayer salteado (el gimnasio), hecho anteayer.
    expect(getStreakFromCompletions([at(0), at(2)], [key(1)])).toBe(2);
    // Sin el salteado, ese hueco sí la corta.
    expect(getStreakFromCompletions([at(0), at(2)])).toBe(1);
  });

  it("un día salteado tampoco suma: no infla la racha", () => {
    expect(getStreakFromCompletions([at(0), at(1), at(3)], [key(2)])).toBe(3);
    expect(getStreakFromCompletions([at(0), at(1), at(2)])).toBe(3);
  });

  it("varios salteados seguidos se atraviesan", () => {
    expect(getStreakFromCompletions([at(0), at(4)], [key(1), key(2), key(3)])).toBe(2);
  });

  it("un hueco que no es salteado sigue cortando", () => {
    expect(getStreakFromCompletions([at(0), at(4)], [key(1), key(3)])).toBe(1);
  });

  it("solo salteados y ninguna tarea hecha no es una racha", () => {
    expect(getStreakFromCompletions([], [key(1), key(2)])).toBe(0);
    expect(getStreakFromCompletions([at(5)], [key(1), key(2)])).toBe(0);
  });

  it("ayer salteado y hoy sin hacer todavía mantiene viva la racha anterior", () => {
    expect(getStreakFromCompletions([at(2), at(3)], [key(1)])).toBe(2);
  });

  it("no cambia nada cuando no hay salteados", () => {
    expect(getStreakFromCompletions([at(0), at(1), at(3)], [])).toBe(2);
  });
});

describe("mejor racha con días neutrales", () => {
  it("atraviesa los salteados y no los cuenta", () => {
    const neutral = new Set(["2026-09-02", "2026-09-03"]);
    expect(bestStreakFromDayKeys(["2026-09-01", "2026-09-04", "2026-09-05"], neutral)).toBe(3);
    expect(bestStreakFromDayKeys(["2026-09-01", "2026-09-04", "2026-09-05"], new Set())).toBe(2);
  });

  it("un hueco parcialmente neutral corta", () => {
    expect(bestStreakFromDayKeys(["2026-09-01", "2026-09-04"], new Set(["2026-09-02"]))).toBe(1);
  });

  it("no hay días, no hay racha", () => {
    expect(bestStreakFromDayKeys([], new Set(["2026-09-02"]))).toBe(0);
  });
});
