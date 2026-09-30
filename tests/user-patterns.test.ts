import { describe, expect, it } from "vitest";
import {
  adjustedEstimate,
  estimateHint,
  chronicPostponers,
  computePatterns,
  dayPartOf,
  inflationFor,
  learnInflationByCategory,
  productiveHours,
  type HistoryEntry
} from "@/lib/user-patterns";

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  title: "t",
  category: "study",
  estimateMin: 30,
  actualMin: null,
  completed: true,
  completedHour: null,
  postponedCount: 0,
  ...over
});

const measured = (category: string, estimate: number, actual: number, n = 1): HistoryEntry[] =>
  Array.from({ length: n }, () => entry({ category, estimateMin: estimate, actualMin: actual }));

describe("learnInflationByCategory", () => {
  it("sin datos: nada aprendido y todo cae al default", () => {
    const result = learnInflationByCategory([]);
    expect(result.global).toEqual({ factor: 1.3, samples: 0, learned: false });
    expect(result.categories).toEqual({});
    expect(inflationFor(result, "study")).toMatchObject({ factor: 1.3, source: "default" });
    expect(inflationFor(result, "study", 1)).toMatchObject({ factor: 1, source: "default" });
  });

  it("pocas muestras (menos de 5): no aprende", () => {
    const result = learnInflationByCategory(measured("study", 30, 60, 4));
    expect(result.global.learned).toBe(false);
    expect(result.categories.study).toMatchObject({ learned: false, source: "default", samples: 4 });
  });

  it("aprende la mediana por categoría, acotada entre 1.0 y 2.0", () => {
    const result = learnInflationByCategory([
      ...measured("study", 30, 45, 5), // 1.5
      ...measured("home", 30, 24, 5), // 0.8 -> 1.0
      ...measured("work", 30, 120, 5) // 4.0 -> 2.0
    ]);
    expect(result.categories.study).toMatchObject({ factor: 1.5, learned: true, source: "category" });
    expect(result.categories.home).toMatchObject({ factor: 1, source: "category" });
    expect(result.categories.work).toMatchObject({ factor: 2, source: "category" });
  });

  it("un outlier no mueve la mediana", () => {
    const result = learnInflationByCategory([
      ...measured("study", 30, 45, 5),
      entry({ category: "study", estimateMin: 30, actualMin: 600 })
    ]);
    expect(result.categories.study.factor).toBe(1.5);
  });

  it("categoría con pocas muestras cae al factor global", () => {
    const result = learnInflationByCategory([
      ...measured("study", 30, 45, 6), // global: 1.5 (y study)
      ...measured("home", 30, 60, 2) // pocas
    ]);
    expect(result.global).toMatchObject({ factor: 1.5, learned: true });
    expect(result.categories.home).toMatchObject({ factor: 1.5, source: "global", learned: false, samples: 2 });
    // una categoría que nunca apareció también usa el global
    expect(inflationFor(result, "sport")).toMatchObject({ factor: 1.5, source: "global" });
  });

  it("ignora lo que no se midió: tildadas sin foco, pendientes y datos inválidos", () => {
    const result = learnInflationByCategory([
      ...measured("study", 30, 45, 4),
      entry({ actualMin: null }),
      entry({ completed: false, actualMin: 90 }),
      entry({ estimateMin: 0, actualMin: 30 }),
      entry({ estimateMin: null, actualMin: 30 })
    ]);
    expect(result.global.samples).toBe(4);
    expect(result.global.learned).toBe(false);
  });

  it("normaliza la categoría (mayúsculas, espacios, vacía = general)", () => {
    const result = learnInflationByCategory([
      ...measured(" Study ", 30, 45, 3),
      ...measured("study", 30, 45, 2),
      ...measured("", 30, 45, 5)
    ]);
    expect(result.categories.study).toMatchObject({ samples: 5, learned: true });
    expect(result.categories.general).toMatchObject({ samples: 5, learned: true });
  });

  it("adjustedEstimate redondea hacia arriba a múltiplos de 5", () => {
    expect(adjustedEstimate(30, 1.5)).toBe(45);
    expect(adjustedEstimate(30, 1.3)).toBe(40);
    expect(adjustedEstimate(20, 1)).toBe(20);
  });
});

describe("productiveHours", () => {
  const at = (hour: number, n = 1) => Array.from({ length: n }, () => entry({ completedHour: hour }));

  it("franjas: madrugada 0-6, mañana 6-12, tarde 12-19, noche 19-24", () => {
    expect([0, 5, 6, 11, 12, 18, 19, 23].map(dayPartOf)).toEqual([
      "night", "night", "morning", "morning", "afternoon", "afternoon", "evening", "evening"
    ]);
    expect(dayPartOf(24)).toBeNull();
    expect(dayPartOf(-1)).toBeNull();
  });

  it("sin datos: no aprendida, faltan 15", () => {
    const result = productiveHours([]);
    expect(result).toMatchObject({ total: 0, learned: false, needed: 15, best: null });
  });

  it("14 completadas: todavía no; 15: sí", () => {
    const short = productiveHours(at(9, 14));
    expect(short).toMatchObject({ learned: false, needed: 1, best: null });
    expect(short.counts.morning).toBe(14); // se cuenta igual, solo no se concluye
    const enough = productiveHours(at(9, 15));
    expect(enough).toMatchObject({ learned: true, needed: 0, best: "morning" });
    expect(enough.shares.morning).toBe(100);
  });

  it("elige la franja con más completadas y da porcentajes", () => {
    const result = productiveHours([...at(9, 6), ...at(15, 3), ...at(21, 3), ...at(2, 3)]);
    expect(result.best).toBe("morning");
    expect(result.shares).toEqual({ morning: 40, afternoon: 20, evening: 20, night: 20 });
  });

  it("un empate en el primer puesto no nombra ninguna", () => {
    expect(productiveHours([...at(9, 8), ...at(15, 8)]).best).toBeNull();
  });

  it("no cuenta las pendientes ni las que no tienen hora", () => {
    const result = productiveHours([
      ...at(9, 3),
      entry({ completedHour: 9, completed: false }),
      entry({ completedHour: null })
    ]);
    expect(result.total).toBe(3);
  });
});

describe("chronicPostponers", () => {
  const p = (title: string, category: string, postponedCount: number) => entry({ title, category, postponedCount });

  it("sin datos: nada", () => {
    expect(chronicPostponers([])).toEqual({ tasks: [], categories: [] });
  });

  it("una tarea es crónica desde 3 postergaciones", () => {
    const result = chronicPostponers([p("A", "study", 2), p("B", "study", 3), p("C", "home", 7)]);
    expect(result.tasks.map((t) => [t.title, t.count])).toEqual([["C", 7], ["B", 3]]);
  });

  it("una categoría es crónica con 3+ postergaciones en al menos 2 tareas", () => {
    const result = chronicPostponers([p("A", "study", 1), p("B", "study", 2), p("C", "home", 1)]);
    expect(result.categories).toEqual([{ category: "study", count: 3, tasks: 2 }]);
  });

  it("una sola tarea terca no vuelve crónica a su categoría", () => {
    const result = chronicPostponers([p("A", "study", 5)]);
    expect(result.tasks).toHaveLength(1);
    expect(result.categories).toEqual([]);
  });
});

describe("computePatterns", () => {
  it("junta todo y dice cuántas medidas faltan", () => {
    const patterns = computePatterns([...measured("study", 30, 45, 3), entry({ completedHour: 9 })]);
    expect(patterns.entries).toBe(4);
    expect(patterns.measuredNeeded).toBe(2);
    expect(patterns.hours.total).toBe(1);
  });
});

describe("estimateHint", () => {
  const learned = learnInflationByCategory([...measured("study", 30, 45, 6), ...measured("home", 30, 30, 6)]);

  it("con aprendizaje de la categoría, dice cuánto suele tardar", () => {
    expect(estimateHint(learned, "study", 30)).toEqual({ scope: "category", category: "study", adjustedMin: 45 });
    expect(estimateHint(learned, " Study ", 60)).toMatchObject({ adjustedMin: 90 });
  });

  it("una categoría sin medición usa el promedio general, y lo dice", () => {
    // global = mediana de (1.5 ×6, 1.0 ×6) = 1.25
    expect(estimateHint(learned, "sport", 40)).toEqual({ scope: "general", category: "sport", adjustedMin: 50 });
  });

  it("no habla sin aprendizaje ni cuando la diferencia no importa", () => {
    expect(estimateHint(learnInflationByCategory([]), "study", 30)).toBeNull();
    expect(estimateHint(learned, "home", 30)).toBeNull(); // factor 1.0
    expect(estimateHint(learned, "study", 6)).toBeNull(); // 6 -> 10: una diferencia de 4 min no importa
  });

  it("estimaciones inválidas no dan pista", () => {
    expect(estimateHint(learned, "study", 0)).toBeNull();
    expect(estimateHint(learned, "study", Number.NaN)).toBeNull();
  });
});
