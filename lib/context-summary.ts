/**
 * Del texto de los archivos al `context_summary` de un proyecto.
 *
 * Pura: quien la usa le pasa la función que resume (la IA en producción, un
 * doble en los tests). Reglas:
 *  - el contexto total no pasa de TOTAL_BUDGET caracteres, repartido entre los
 *    archivos;
 *  - un texto que ya entra en su parte se guarda tal cual: resumir de más pierde
 *    justo los detalles (fechas, entregables) que hacen falta para planificar;
 *  - un texto largo se parte en trozos, cada trozo se resume y después se
 *    resumen los resúmenes ("por partes"), en vez de mandar 100 000 caracteres
 *    de una sola vez.
 */

export const TOTAL_BUDGET = 6000;
/** Un trozo que se manda a resumir de una vez. */
export const CHUNK_CHARS = 10_000;
/** Con más texto que esto se resume por partes en vez de en una sola pasada. */
export const SINGLE_PASS_MAX = 12_000;
const MAX_CHUNKS = 20;

export type Summarize = (text: string, maxChars: number, hint: string) => Promise<string>;

export type SourceFile = { name: string; text: string };

/** Corta en trozos de a lo sumo `size`, prefiriendo el final de un párrafo o una línea. */
export function chunkText(text: string, size: number = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size && chunks.length < MAX_CHUNKS - 1) {
    const window = rest.slice(0, size);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const at = cut > size * 0.5 ? cut + 1 : size;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.length > 0) chunks.push(rest.length > size ? rest.slice(0, size) : rest);
  return chunks.filter((c) => c.length > 0);
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** Lo que se le pide a cada trozo: corto, para que juntar los resúmenes siga siendo chico. */
const PART_SUMMARY_CHARS = 800;
/** Frena la recursión; cada nivel achica el texto, así que no se llega en la práctica. */
const MAX_REDUCE_DEPTH = 4;

/**
 * Junta resúmenes parciales en uno de a lo sumo `budget` caracteres sin mandarle
 * nunca a la IA más de un trozo: si lo juntado todavía es largo, se vuelve a partir
 * y a resumir por grupos.
 */
async function reduce(parts: string[], budget: number, summarize: Summarize, depth = 0): Promise<string> {
  const joined = parts.join("\n");
  if (joined.length <= budget) return joined;
  if (joined.length <= SINGLE_PASS_MAX || depth >= MAX_REDUCE_DEPTH) {
    return clip(await summarize(joined.slice(0, SINGLE_PASS_MAX), budget, "summaries of the parts of one document"), budget);
  }
  const next: string[] = [];
  for (const group of chunkText(joined)) {
    next.push(clip(await summarize(group, PART_SUMMARY_CHARS, "summaries of the parts of one document"), PART_SUMMARY_CHARS));
  }
  return reduce(next, budget, summarize, depth + 1);
}

async function summarizeOne(text: string, budget: number, summarize: Summarize): Promise<string> {
  if (text.length <= budget) return text;

  if (text.length <= SINGLE_PASS_MAX) {
    return clip(await summarize(text, budget, "document"), budget);
  }

  // Por partes: cada trozo a su resumen, y los resúmenes a uno solo.
  const partials: string[] = [];
  for (const chunk of chunkText(text)) {
    partials.push(clip(await summarize(chunk, PART_SUMMARY_CHARS, "part of a longer document"), PART_SUMMARY_CHARS));
  }
  return reduce(partials, budget, summarize);
}

/** El resumen de contexto de un proyecto a partir de los textos de sus archivos. */
export async function buildContextSummary(files: SourceFile[], summarize: Summarize): Promise<string> {
  const usable = files.filter((f) => f.text.trim().length > 0);
  if (usable.length === 0) return "";

  // Each file keeps its heading, which is not free.
  const budget = Math.floor(TOTAL_BUDGET / usable.length) - 40;
  const sections: string[] = [];
  for (const file of usable) {
    const body = await summarizeOne(file.text.trim(), Math.max(200, budget), summarize);
    sections.push(`## ${file.name.slice(0, 60)}\n${body}`);
  }
  return clip(sections.join("\n\n"), TOTAL_BUDGET);
}
