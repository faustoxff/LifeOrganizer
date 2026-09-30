import { describe, expect, it } from "vitest";
import { DEFAULT_INFLATION, learnInflation } from "@/lib/estimate-learning";

const samples = (ratios: number[], estimateMin = 60) =>
  ratios.map((r) => ({ estimateMin, actualMin: Math.round(estimateMin * r) }));

describe("learnInflation", () => {
  it("con menos de 5 muestras usa el default, sin importar lo que digan", () => {
    expect(learnInflation([])).toEqual({ factor: 1.3, samples: 0, learned: false });
    expect(learnInflation(samples([2, 2, 2, 2]))).toEqual({ factor: DEFAULT_INFLATION, samples: 4, learned: false });
  });

  it("con 5 o más aprende la mediana de real / estimado", () => {
    const result = learnInflation(samples([1.2, 1.5, 1.4, 1.6, 1.3]));
    expect(result).toEqual({ factor: 1.4, samples: 5, learned: true });
  });

  it("usa la mediana y no el promedio: un valor extremo no arrastra el factor", () => {
    // Promedio = 1.9; mediana = 1.2.
    expect(learnInflation(samples([1.1, 1.2, 1.2, 1.3, 4.7])).factor).toBe(1.2);
  });

  it("con cantidad par promedia los dos del medio", () => {
    expect(learnInflation(samples([1.2, 1.2, 1.4, 1.4, 1.6, 1.8])).factor).toBe(1.4);
  });

  it("nunca baja de 1.0: terminar antes no autoriza planes sin margen", () => {
    expect(learnInflation(samples([0.5, 0.6, 0.7, 0.8, 0.9])).factor).toBe(1);
  });

  it("nunca pasa de 2.0", () => {
    expect(learnInflation(samples([3, 3.5, 4, 5, 6])).factor).toBe(2);
  });

  it("ignora las muestras inválidas y no cuenta esas para el mínimo", () => {
    const junk = [
      { estimateMin: 0, actualMin: 30 },
      { estimateMin: 30, actualMin: 0 },
      { estimateMin: -5, actualMin: 10 },
      { estimateMin: NaN, actualMin: 10 }
    ];
    expect(learnInflation([...junk, ...samples([1.5, 1.5, 1.5, 1.5])]).learned).toBe(false);
    expect(learnInflation([...junk, ...samples([1.5, 1.5, 1.5, 1.5, 1.5])])).toEqual({ factor: 1.5, samples: 5, learned: true });
  });

  it("pondera igual una subtarea corta que una larga (mide proporción, no minutos)", () => {
    const mixed = [
      { estimateMin: 10, actualMin: 15 },
      { estimateMin: 240, actualMin: 360 },
      { estimateMin: 30, actualMin: 45 },
      { estimateMin: 60, actualMin: 90 },
      { estimateMin: 120, actualMin: 180 }
    ];
    expect(learnInflation(mixed).factor).toBe(1.5);
  });

  it("redondea a dos decimales", () => {
    expect(learnInflation(samples([1.333333, 1.333333, 1.333333, 1.333333, 1.333333], 300)).factor).toBe(1.33);
  });
});
