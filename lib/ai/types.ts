/**
 * Provider-neutral types for text generation.
 *
 * Milo's chat used to talk to Groq directly, which meant every call site knew
 * about one vendor's SDK, one vendor's model names and one vendor's failure
 * modes. With a 200k-tokens-per-day ceiling that is not a neutral detail: the
 * day the budget ran out, every user got the same error at the same time and
 * there was nowhere else to send the request. These types are the seam.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

/**
 * Tool calling. A tool is declared once (name, description, JSON schema) and the
 * model answers with calls to it instead of writing a machine block inside its text.
 * `arguments` stays the raw JSON string the model produced: parsing (and rejecting
 * what does not parse) is the caller's job, because only the caller knows the schema.
 */
export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; arguments: string };

/** An assistant turn that asked for tools. `content` is whatever text came with it. */
export type AssistantToolMessage = { role: "assistant"; content: string; toolCalls: ToolCall[] };

/** The result of one call, sent back so the model can continue. */
export type ToolResultMessage = { role: "tool"; toolCallId: string; content: string };

/** Everything a provider can be sent: plain messages plus the two tool-loop ones. */
export type AgentMessage = ChatMessage | AssistantToolMessage | ToolResultMessage;

/** "auto" lets the model decide, "none" forces a plain-text answer. */
export type ToolChoice = "auto" | "none";

/**
 * Quality tier. Callers declare what they need rather than the chain guessing
 * from the text: a deterministic guess at "is this message simple" is a guess,
 * and a wrong guess either costs quality or costs money. The cheap callers
 * (memory summaries, companion nudges) know they are cheap.
 *
 * `planner` is for splitting a whole project into subtasks. It is its own tier
 * (rather than reusing `pro`) so it can be pointed at a stronger model without
 * making every Pro chat turn pay for it; with no override it falls back to the
 * `pro` model.
 */
export type ModelTier = "fast" | "standard" | "pro" | "planner";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type Completion = {
  content: string;
  /** OpenAI-style: "stop" | "length" | "tool_calls" | ... */
  finishReason: string | null;
  /** Present only when the model asked for tools. */
  toolCalls?: ToolCall[];
  model: string;
  provider: string;
  usage: TokenUsage;
};

export type CompletionRequest = {
  messages: AgentMessage[];
  tier: ModelTier;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  /**
   * Tools the model may call. Only providers whose configured model supports tools
   * are tried; if none does, the call fails with a `bad_request` so the caller can
   * fall back to a text-only path.
   */
  tools?: ToolSpec[];
  toolChoice?: ToolChoice;
  /**
   * Providers to try in order. Defaults to the configured chain. Callers set
   * this only in tests.
   */
  order?: string[];
  /**
   * Replaces the chain outright. Only for tests, which need a fresh provider —
   * and therefore a fresh breaker, keyed by provider id — on every case.
   */
  providers?: ProviderAdapter[];
};

/**
 * Why a provider failed. The distinction that matters is not "error" vs "no
 * error", it is "should the next provider be tried" and "should this provider
 * be quarantined".
 *
 *  - rate_limited: the account is out of budget or throttled. Try the next
 *    provider, and stop sending this one anything for a while.
 *  - auth: the key is missing, wrong or revoked. Quarantine immediately: it
 *    will never start working on its own, and retrying only burns latency.
 *  - bad_request: our request or model name is wrong. Do NOT quarantine, the
 *    next provider may well be configured correctly.
 *  - timeout / server / network: transient, worth another provider.
 */
export type FailureKind =
  | "rate_limited"
  | "auth"
  | "bad_request"
  | "timeout"
  | "server"
  | "network"
  | "unknown";

/**
 * Which ceiling was hit.
 *
 * A 429 is not one thing. Groq enforces tokens-per-minute, requests-per-minute,
 * tokens-per-day and requests-per-day separately, and they call all of them
 * `Rate limit reached`. The recovery times differ by three orders of magnitude:
 * a per-minute throttle clears in seconds, a daily budget does not clear until
 * midnight. Treating both as "wait five minutes" is what makes a circuit
 * breaker worse than no breaker — it either recovers too eagerly and burns
 * requests, or recovers too late and takes a healthy provider out.
 */
export type RateLimitScope = "per_minute" | "per_day" | "unknown";

const MINUTE = 60_000;

/** Read the ceiling out of the provider's own wording. */
export function rateLimitScope(message: string | undefined): RateLimitScope {
  if (!message) return "unknown";
  // "on tokens per day (TPD)", "on requests per minute (RPM)", etc.
  if (/\b(tpd|rpd)\b|per\s+day/i.test(message)) return "per_day";
  if (/\b(tpm|rpm)\b|per\s+minute/i.test(message)) return "per_minute";
  return "unknown";
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly kind: FailureKind;
  readonly status?: number;
  /** Milliseconds the provider asked us to wait, if it said so. */
  readonly retryAfterMs?: number;
  /**
   * Every failure seen across the chain, when this error came from trying more
   * than one provider. The route needs to tell "busy" apart from "broken", and
   * a single `kind` on the wrapper would flatten exactly that distinction: one
   * provider out of budget while the other is misconfigured is a capacity
   * problem, two 400s are our bug.
   */
  readonly kinds?: FailureKind[];
  /** Only meaningful when `kind` is `rate_limited`. */
  readonly scope?: RateLimitScope;

  constructor(
    message: string,
    options: {
      provider: string;
      kind: FailureKind;
      status?: number;
      retryAfterMs?: number;
      kinds?: FailureKind[];
      scope?: RateLimitScope;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = options.provider;
    this.kind = options.kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    if (options.kinds) this.kinds = options.kinds;
    if (options.scope) this.scope = options.scope;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Pull a wait hint out of a provider's error text.
 *
 * Groq answers a blown daily budget with "Please try again in 9m6.48s". Taking
 * it at face value is not enough on its own: that estimate is derived from the
 * current burn rate, whereas a tokens-per-day limit resets on a fixed boundary,
 * so it will happily tell you to come back in nine minutes on an account that
 * is done for the day. The caller combines this with its own floor.
 */
export function parseRetryAfterHint(message: string | undefined): number | undefined {
  if (!message) return undefined;

  const retryAfterSeconds = message.match(/retry[-_ ]?after["':\s]+(\d+(?:\.\d+)?)/i);
  if (retryAfterSeconds) return Math.round(Number(retryAfterSeconds[1]) * 1000);

  const human = message.match(/try again in\s+((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?)?s?)/i);
  if (!human) return undefined;

  const [, hours, minutes, seconds] =
    human[1].match(/(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i) ?? [];
  if (!hours && !minutes && !seconds) return undefined;

  return (
    Number(hours ?? 0) * 60 * MINUTE + Number(minutes ?? 0) * MINUTE + Number(seconds ?? 0) * 1000
  );
}

/**
 * Map a raw failure onto a {@link FailureKind}. Pure, so the routing decisions
 * that decide whether a user sees an answer can be tested without a network.
 */
export function classifyFailure(input: {
  status?: number;
  name?: string;
  message?: string;
}): FailureKind {
  const { status, name, message } = input;

  // 408 has to be singled out before the generic 4xx range below. It is the
  // one client-error status that means "try again later" rather than "your
  // request is wrong", and lumping it in with 4xx would mean a timed-out request
  // never trips the breaker.
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status !== undefined && status >= 400 && status < 500) return "bad_request";

  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  // A bare `TypeError: fetch failed` is how undici reports a dead socket, and
  // `status` is undefined in that case.
  if (name === "TypeError" && status === undefined) return "network";
  if (status !== undefined && status >= 500) return "server";

  if (message) {
    if (/rate limit|too many requests|quota|insufficient_quota/i.test(message)) {
      return "rate_limited";
    }
    if (/api key|unauthorized|forbidden|invalid.*key/i.test(message)) return "auth";
  }

  return "unknown";
}

export type ProviderRequest = {
  messages: AgentMessage[];
  tools?: ToolSpec[];
  toolChoice?: ToolChoice;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  tier: ModelTier;
  /** Only sent to providers that advertise support. */
  reasoningEffort?: "low" | "medium" | "high" | "none";
};

export type ProviderAdapter = {
  id: string;
  label: string;
  /** False when the key is absent, so the chain skips it without a wasted call. */
  configured(): boolean;
  modelFor(tier: ModelTier): string;
  complete(request: ProviderRequest): Promise<Completion>;
  supportsReasoningEffort?: boolean;
  /** Whether `model` can be sent `tools`. Absent = no. Asked per model: a fallback model may not. */
  supportsTools?(model: string): boolean;
  /**
   * Whether the configured models can read images. Messages are plain text today,
   * so no adapter claims it; the project flow leaves images out because of it.
   */
  supportsVision?: boolean;
};

/** Whether a failure should count against the provider's health.
 *
 * A 400 from a misnamed model is our bug, not the provider being unhealthy, so
 * quarantining on it would take a working provider out of rotation over a typo.
 */
export function shouldTripBreaker(kind: FailureKind): boolean {
  return (
    kind === "rate_limited" ||
    kind === "auth" ||
    kind === "timeout" ||
    kind === "server" ||
    kind === "network"
  );
}

/**
 * Whether a failure should skip the "wait for N failures" grace period.
 *
 * A wrong key will not start working by being retried, so there is no reason to
 * spend the threshold's worth of requests rediscovering that on every user
 * request. A 429 is deliberately not immediate: a single throttle is normal and
 * the next provider usually answers fine.
 */
export function tripsImmediately(kind: FailureKind): boolean {
  return kind === "auth";
}
