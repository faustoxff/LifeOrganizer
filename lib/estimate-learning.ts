/**
 * Cuánto se pasa (o se ahorra) cada usuario respecto de lo que estima.
 *
 * El scheduler infla las estimaciones por un factor para no armar planes al
 * límite. Un factor fijo castiga al que estima bien y no protege al que estima
 * corto, así que se aprende de su historial: la mediana de real / estimado.
 */

export const DEFAULT_INFLATION = 1.3;
export const MIN_INFLATION = 1.0;
export const MAX_INFLATION = 2.0;
/** Con menos muestras que esto la mediana es ruido y se usa el default. */
export const MIN_SAMPLES = 5;

export type EstimateSample = { estimateMin: number; actualMin: number };

export type LearnedInflation = {
  factor: number;
  /** Muestras válidas que se usaron para decidir. */
  samples: number;
  /** false = no había suficientes y se devolvió el default. */
  learned: boolean;
};

function isUsable(sample: EstimateSample): boolean {
  return (
    Number.isFinite(sample.estimateMin) &&
    Number.isFinite(sample.actualMin) &&
    sample.estimateMin > 0 &&
    sample.actualMin > 0
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Factor de inflación de un usuario: mediana de actual / estimado, acotada entre
 * 1.0 y 2.0, redondeada a dos decimales. Mediana y no promedio: una subtarea que
 * se eternizó una vez no debe inflar todos los planes siguientes.
 *
 * Nunca baja de 1.0 aunque el usuario termine antes: un plan sin margen es justo
 * el que se rompe con el primer imprevisto.
 */
export function learnInflation(history: readonly EstimateSample[]): LearnedInflation {
  const usable = history.filter(isUsable);
  if (usable.length < MIN_SAMPLES) {
    return { factor: DEFAULT_INFLATION, samples: usable.length, learned: false };
  }

  const ratio = median(usable.map((s) => s.actualMin / s.estimateMin));
  const clamped = Math.min(MAX_INFLATION, Math.max(MIN_INFLATION, ratio));
  return { factor: Math.round(clamped * 100) / 100, samples: usable.length, learned: true };
}
