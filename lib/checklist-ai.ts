import "server-only";
import { complete } from "@/lib/ai/complete";
import type { ChatMessage, Completion } from "@/lib/ai/types";
import { normalizeActivityKey, normalizeTitle } from "@/lib/activity";
import { sanitizeItems, type ChecklistItem } from "@/lib/checklist";
import { buildClassifyMessages, buildGenerateMessages, buildRetryMessages, type ChecklistPromptInput } from "@/lib/checklist-prompts";
import { extractJsonObject, type ParseResult } from "@/lib/project-schema";

/**
 * Las dos llamadas de IA de las checklists: armar la lista inicial de una actividad y
 * clasificar en lote los títulos que las reglas no reconocen. Una llamada, validación y un
 * reintento que dice qué se rechazó; si el segundo también falla se lanza y quien llama
 * sigue sin lista (la checklist queda vacía y el usuario la arma a mano: nada se inventa).
 */

export class ChecklistAiError extends Error {
  constructor(readonly detail: string) {
    super("La IA no pudo armar la checklist esta vez.");
    this.name = "ChecklistAiError";
  }
}

export type ChecklistAiKind = "checklist_generate" | "checklist_detect";

export type ChecklistAiDeps = {
  complete: (request: Parameters<typeof complete>[0]) => Promise<Completion>;
  logUsage: (entry: { userId: string; kind: ChecklistAiKind; completion: Completion }) => Promise<void>;
};

async function defaultLogUsage(entry: { userId: string; kind: ChecklistAiKind; completion: Completion }) {
  const { completion } = entry;
  console.info(
    `[checklist-ai] kind=${entry.kind} user=${entry.userId} provider=${completion.provider} model=${completion.model} ` +
      `in=${completion.usage.inputTokens} out=${completion.usage.outputTokens}`
  );
  try {
    const { logAiTokens } = await import("@/lib/projects-storage");
    await logAiTokens(entry.userId, entry.kind, completion);
  } catch (error) {
    console.warn("[checklist-ai] could not record token usage", error);
  }
}

const defaultDeps: ChecklistAiDeps = { complete, logUsage: defaultLogUsage };

async function askJson<T>(
  deps: ChecklistAiDeps,
  params: { userId: string; kind: ChecklistAiKind; messages: ChatMessage[]; tier: "fast" | "standard"; maxTokens: number; parse: (raw: string) => ParseResult<T> }
): Promise<T> {
  let messages = params.messages;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const completion = await deps.complete({
      messages,
      tier: params.tier,
      maxTokens: params.maxTokens,
      timeoutMs: 25_000,
      temperature: 0.3
    });
    await deps.logUsage({ userId: params.userId, kind: params.kind, completion });
    const parsed = params.parse(completion.content);
    if (parsed.ok) return parsed.value;
    lastError = parsed.error;
    console.warn(`[checklist-ai] ${params.kind} attempt ${attempt} rejected: ${lastError}`);
    messages = [...params.messages, ...buildRetryMessages(completion.content, lastError)];
  }
  throw new ChecklistAiError(lastError);
}

export const MIN_GENERATED_ITEMS = 3;

export function parseGeneratedItems(raw: string): ParseResult<ChecklistItem[]> {
  const json = extractJsonObject(raw);
  if (!json) return { ok: false, error: "The reply is not a valid JSON object." };
  if (!Array.isArray(json.items)) return { ok: false, error: 'Missing the "items" array.' };
  // `sanitizeItems` ya descarta lo inválido, los duplicados y lo que se pasa del largo.
  const items = sanitizeItems(json.items).map((item) => ({ ...item, uses: 0, skips: 0, lastUsedAt: null }));
  if (items.length < MIN_GENERATED_ITEMS) {
    return { ok: false, error: `Need at least ${MIN_GENERATED_ITEMS} valid items, got ${items.length}.` };
  }
  return { ok: true, value: items, warnings: [] };
}

export async function generateInitialList(
  userId: string,
  input: ChecklistPromptInput,
  deps: ChecklistAiDeps = defaultDeps
): Promise<ChecklistItem[]> {
  return askJson(deps, {
    userId,
    kind: "checklist_generate",
    messages: buildGenerateMessages(input),
    // El texto que se ve lo escribe esta llamada: vale un modelo mejor que el de clasificar.
    tier: "standard",
    maxTokens: 700,
    parse: parseGeneratedItems
  });
}

export const MAX_TITLES_PER_BATCH = 15;

/** {título normalizado → clave de actividad o null}, uno por cada título pedido. */
export function parseClassification(raw: string, count: number): ParseResult<Array<string | null>> {
  const json = extractJsonObject(raw);
  if (!json) return { ok: false, error: "The reply is not a valid JSON object." };
  if (!Array.isArray(json.results)) return { ok: false, error: 'Missing the "results" array.' };
  const out: Array<string | null> = Array.from({ length: count }, () => null);
  for (const entry of json.results) {
    if (!entry || typeof entry !== "object") continue;
    const { i, activity } = entry as { i?: unknown; activity?: unknown };
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= count) continue;
    out[i] = activity === null ? null : normalizeActivityKey(activity);
  }
  return { ok: true, value: out, warnings: [] };
}

export async function classifyTitles(
  userId: string,
  titles: readonly string[],
  deps: ChecklistAiDeps = defaultDeps
): Promise<Map<string, string | null>> {
  const unique = [...new Set(titles.map(normalizeTitle).filter(Boolean))].slice(0, MAX_TITLES_PER_BATCH);
  const result = new Map<string, string | null>();
  if (unique.length === 0) return result;
  const keys = await askJson(deps, {
    userId,
    kind: "checklist_detect",
    messages: buildClassifyMessages(unique),
    tier: "fast",
    maxTokens: 400,
    parse: (raw) => parseClassification(raw, unique.length)
  });
  unique.forEach((title, index) => result.set(title, keys[index]));
  return result;
}
