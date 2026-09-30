import "server-only";
import { complete } from "@/lib/ai/complete";
import { rotateAfter } from "@/lib/ai/registry";
import { type ChatMessage, ProviderError, type FailureKind, type ModelTier } from "@/lib/ai/types";
import { AppLanguage } from "@/lib/i18n";

type MiloChatParams = {
  message: string;
  /**
   * Per-turn context: dates, the user's tasks, their memory. Sent as its own
   * message so it never sits in front of the stable half of the prompt.
   */
  context?: string;
  /** Cacheable half of the prompt. Must be identical across turns to be worth it. */
  contextStatic?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  timeoutMs?: number;
  isPro?: boolean;
  /** Overrides the tier implied by `isPro`. Use "fast" for short mechanical output. */
  tier?: ModelTier;
  maxTokens?: number;
};

const DEFAULT_MAX_TOKENS = 1200;

/**
 * The messages for one chat turn: the stable rules first (so a provider can cache them),
 * then the per-turn context, the history, and the user's message — with web results
 * appended to it when it reads like a factual question. Shared by the text path and the
 * tool path so both send Milo exactly the same conversation.
 */
export async function buildChatMessages({
  message,
  context = "",
  contextStatic = "",
  history = [],
  isPro = false
}: Pick<MiloChatParams, "message" | "context" | "contextStatic" | "history" | "isPro">): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [
    ...(contextStatic ? [{ role: "system" as const, content: contextStatic }] : []),
    ...(context ? [{ role: "system" as const, content: context }] : []),
    ...history,
    { role: "user" as const, content: message }
  ];

  if (looksLikeSearchRequest(message)) {
    const results = await searchWithFallback(message, isPro);
    if (results) {
      messages[messages.length - 1] = {
        role: "user",
        content: `${message}\n\n[Resultados de búsqueda web]\n${results}`
      };
    }
  }
  return messages;
}

export async function chatWithMilo({
  message,
  context = "",
  contextStatic = "",
  history = [],
  timeoutMs = 30000,
  isPro = false,
  tier,
  maxTokens
}: MiloChatParams) {
  const requestedTier: ModelTier = tier ?? (isPro ? "pro" : "standard");
  const messages = await buildChatMessages({ message, context, contextStatic, history, isPro });

  const response = await complete({
    messages,
    tier: requestedTier,
    timeoutMs,
    maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS
  });

  const content = response.content;

  // gpt-oss is a reasoning model: when it spends the whole `max_tokens` budget
  // thinking, `content` comes back empty and the user sees a blank chat bubble.
  // The same overrun truncates a TASKS_ACTION block mid-array. Both look like a
  // network error to the user, so retry once — on the other quality tier, and
  // starting from a different provider, since a starved model is a property of
  // that model rather than of the answer.
  const starved = content.trim() === "" || response.finishReason === "length";
  if (starved) {
    const retryTier: ModelTier = requestedTier === "pro" ? "standard" : "pro";
    console.warn(
      `AI "${response.provider}/${response.model}" returned an unusable reply ` +
        `(finish_reason=${response.finishReason}, ${content.length} chars), ` +
        `retrying on tier "${retryTier}" starting after "${response.provider}"`
    );

    try {
      const retry = await complete({
        messages,
        tier: retryTier,
        timeoutMs,
        maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        order: rotateAfter(response.provider)
      });
      if (retry.content.trim() !== "") {
        return { content: retry.content, model: retry.model, provider: retry.provider };
      }
    } catch (error) {
      // Returning the starved-but-parsable reply still beats surfacing an error
      // for a message the caller already has.
      console.warn(
        `[milo] retry after a starved reply failed, returning the original: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return { content, model: response.model, provider: response.provider };
  }

  return { content, model: response.model, provider: response.provider };
}

export async function refreshUserMemorySummary(params: {
  previousSummary: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const conversationText = params.history
    .map((m) => `${m.role === "user" ? "Usuario" : "Milo"}: ${m.content}`)
    .join("\n");

  const prompt = `Sos un sistema que mantiene una memoria compacta sobre un usuario para un asistente de organización personal llamado Milo.

Memoria actual del usuario:
${params.previousSummary || "(sin memoria previa)"}

Conversación reciente:
${conversationText}

Actualizá la memoria en 3-6 líneas cortas (bullet points), integrando lo nuevo relevante con lo que ya se sabía. Enfocate en patrones de comportamiento, preferencias, rutinas, o datos personales relevantes que ayuden a Milo a asistir mejor en el futuro (ej. "suele posponer tareas de X", "prefiere organizar de mañana", "trabaja en Y"). No incluyas información irrelevante ni detalles de tareas puntuales que ya vencieron. Si no hay nada nuevo o relevante, devolvé la memoria actual sin cambios. Respondé SOLO con la memoria actualizada, sin explicaciones ni encabezados.`;

  try {
    // "fast" on purpose: this runs after every long chat, writes text nobody
    // reads unless it is good, and must never be the reason a turn errors.
    const response = await complete({
      messages: [{ role: "user", content: prompt }],
      tier: "fast",
      timeoutMs: 15000,
      temperature: 0.4
    });
    return response.content.trim() || params.previousSummary;
  } catch {
    return params.previousSummary;
  }
}

export type ChatFailure = {
  /** Every provider refused because it was out of budget or throttled. */
  busy: boolean;
  /** Every provider timed out. */
  timedOut: boolean;
  kinds: FailureKind[];
};

/**
 * Tell "Milo is busy" apart from "something is broken".
 *
 * The user-facing copy depends on this. Telling someone "no se pudo conectar"
 * when the truth is that the daily budget ran out sends them to debug their
 * own network for an outage they cannot fix, and there is nothing for them to
 * do about it either way — but at least the message should be true.
 *
 * `busy` requires that *every* failure was a capacity one. A single 400 in the
 * set means a model name or payload is wrong, and no amount of waiting fixes
 * that, so it must not be reported as a transient busy state.
 */
export function classifyChatFailure(error: unknown): ChatFailure {
  if (!(error instanceof ProviderError)) {
    const name = error instanceof Error ? error.name : undefined;
    return { busy: false, timedOut: name === "TimeoutError", kinds: [] };
  }

  const kinds = error.kinds ?? [error.kind];
  const capacityOnly = kinds.every((kind) => kind === "rate_limited");

  return {
    busy: capacityOnly,
    timedOut: kinds.length > 0 && kinds.every((kind) => kind === "timeout"),
    kinds
  };
}

function looksLikeSearchRequest(message: string): boolean {
  const m = message.toLowerCase();
  return [
    // Pedidos explícitos de búsqueda
    "busca", "buscá", "buscar", "googlea", "googleá", "google",
    "search", "look up", "find", "busca en internet", "busca en la web",
    // Preguntas factuales
    "qué es", "que es", "qué significa", "que significa",
    "cómo se hace", "como se hace", "cómo funciona", "como funciona",
    "cómo instalar", "como instalar", "cómo configurar", "como configurar",
    "cómo se consigue", "como se consigue", "cómo obtener", "como obtener",
    "cuál es", "cual es", "cuánto cuesta", "cuanto cuesta",
    "cuánto tarda", "cuanto tarda", "cuándo sale", "cuando sale",
    "cuándo fue", "cuando fue", "cuándo es", "cuando es",
    "quién es", "quien es", "quiénes son", "quienes son",
    "dónde queda", "donde queda", "dónde está", "donde esta",
    // Temas que requieren info real
    "noticias", "novedades", "últimas noticias",
    "precio de", "costo de", "cuánto sale", "cuanto sale",
    "requisitos", "especificaciones", "specs",
    // Juegos, tecnología, cultura
    "en world of warcraft", "en wow", "en minecraft", "en fortnite",
    "en el juego", "en steam", "como conseguir",
    "existe", "es real", "es verdad", "es cierto"
  ].some((kw) => m.includes(kw));
}

async function searchWithFallback(query: string, isPro: boolean): Promise<string> {
  if (isPro) {
    const tavilyKey = process.env.TAVILY_API_KEY ?? "";
    if (tavilyKey) {
      const result = await searchTavily(query, tavilyKey);
      if (result) return result;
    }
  }
  return searchSearXNG(query);
}

async function searchTavily(query: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        include_answer: true,
        search_depth: "basic"
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return "";

    const data = (await response.json()) as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };

    const lines: string[] = [];
    if (data.answer) lines.push(`Resumen: ${data.answer}`);
    for (const r of (data.results ?? []).slice(0, 4)) {
      lines.push(`\n— ${r.title}\n${r.content.slice(0, 400)}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

const SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://searxng.world",
  "https://paulgo.io"
];

async function searchSearXNG(query: string): Promise<string> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&language=auto`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        results?: Array<{ title: string; url: string; content?: string }>;
      };

      const lines: string[] = [];
      for (const r of (data.results ?? []).slice(0, 5)) {
        if (r.content) lines.push(`\n— ${r.title}\n${r.content.slice(0, 400)}`);
      }
      if (lines.length > 0) return lines.join("\n");
    } catch {
      continue;
    }
  }
  return "";
}

export function getMiloErrorMessage(error: unknown, actionLabel: string, language: AppLanguage = "en") {
  const isSpanish = language === "es";

  if (!error || typeof error !== "object") {
    return isSpanish
      ? `No se pudo generar ${actionLabel} en este momento.`
      : `Couldn't generate ${actionLabel} right now.`;
  }

  const err = error as { status?: number; message?: string; name?: string };

  if (err.name === "TimeoutError") {
    return isSpanish
      ? `Milo tardó demasiado en responder para ${actionLabel}.`
      : `Milo took too long to respond for ${actionLabel}.`;
  }

  if (err.message) {
    return isSpanish
      ? `No se pudo generar ${actionLabel}: ${err.message}`
      : `Couldn't generate ${actionLabel}: ${err.message}`;
  }

  return isSpanish
    ? `No se pudo generar ${actionLabel} en este momento.`
    : `Couldn't generate ${actionLabel} right now.`;
}

export function parseJsonObject<T>(value: string): T | null {
  const directParse = safeParseJson<T>(value);
  if (directParse) return directParse;

  const extracted = extractFirstJsonObject(value);
  if (!extracted) return null;

  return safeParseJson<T>(extracted);
}

function safeParseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(value: string) {
  const startIndex = value.indexOf("{");
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (isEscaped) { isEscaped = false; continue; }
      if (character === "\\") { isEscaped = true; continue; }
      if (character === '"') { inString = false; }
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") { depth += 1; continue; }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(startIndex, index + 1);
    }
  }
  return null;
}
