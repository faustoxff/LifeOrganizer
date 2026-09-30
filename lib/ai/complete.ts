import "server-only";
import { CircuitBreaker, type ProviderHealth } from "@/lib/ai/circuit-breaker";
import { getProviderChain } from "@/lib/ai/registry";
import {
  type Completion,
  type CompletionRequest,
  type FailureKind,
  type ModelTier,
  ProviderAdapter,
  ProviderError,
  type ProviderRequest
} from "@/lib/ai/types";

/**
 * One `complete()` in front of several providers.
 *
 * The reason this exists is a specific outage, not a hypothetical: Groq's free
 * plan allows 200k tokens per day per model. When that ran out, every user got
 * "Milo está con muchos mensajes ahora" at the same time and there was nowhere
 * to send the request instead. A single provider with a retry inside it cannot
 * fix that; only a second provider can.
 *
 * What the chain deliberately does NOT do is retry blindly. A provider that is
 * out of budget fails in about 200ms, so every turn would pay a wasted round
 * trip before falling through. The breaker quarantines it instead, and a single
 * probe is admitted when the cooldown expires.
 */

const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_TEMPERATURE = 0.7;

const breaker = new CircuitBreaker();

/** The chain's own attempts. Independent of any fallback inside a provider. */
const MAX_ATTEMPTS = 3;

export async function complete(request: CompletionRequest): Promise<Completion> {
  // `order` is a sequence, not a set. Treating it as a filter would leave the
  // default chain order intact, which quietly turns `rotateAfter` into a no-op
  // and makes a retry for a starved reply hit the same model that starved.
  const base = request.providers ?? getProviderChain();
  const chain = request.order
    ? request.order
        .map((id) => base.find((provider) => provider.id === id))
        .filter((provider): provider is ProviderAdapter => Boolean(provider))
    : base;

  const configured = chain.filter((provider) => provider.configured());
  if (configured.length === 0) {
    throw new ProviderError("No hay ningún proveedor de IA configurado", {
      provider: "chain",
      kind: "auth"
    });
  }

  // A provider that cannot take tools is skipped, not tried and failed: a model that
  // ignores `tools` answers in prose, which the caller would take for a real reply
  // that just happened to call nothing. Skipping also keeps it out of the breaker.
  const wantsTools = Boolean(request.tools?.length);
  const available = wantsTools
    ? configured.filter((provider) => provider.supportsTools?.(provider.modelFor(request.tier)) === true)
    : configured;
  if (available.length === 0) {
    throw new ProviderError("Ningún proveedor configurado soporta tools con el modelo elegido", {
      provider: "chain",
      kind: "bad_request",
      kinds: ["bad_request"]
    });
  }

  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = request.temperature ?? DEFAULT_TEMPERATURE;
  const failures: string[] = [];
  const kinds: FailureKind[] = [];

  for (const provider of available) {
    const decision = breaker.acquire(provider.id);
    if (decision === "open") {
      console.warn(`[ai] skipping "${provider.id}": quarantined after earlier failures`);
      failures.push(`${provider.id}: quarantined`);
      kinds.push("rate_limited");
      continue;
    }

    const providerRequest: ProviderRequest = {
      messages: request.messages,
      model: provider.modelFor(request.tier),
      maxTokens,
      temperature,
      timeoutMs: request.timeoutMs,
      tier: request.tier,
      reasoningEffort: resolveReasoningEffort(provider, request.tier),
      ...(wantsTools ? { tools: request.tools, toolChoice: request.toolChoice ?? "auto" } : {})
    };

    try {
      const result = await provider.complete(providerRequest);
      breaker.recordSuccess(provider.id, result.usage);

      if (failures.length > 0) {
        console.warn(`[ai] served by "${provider.id}" after: ${failures.join("; ")}`);
      }
      return result;
    } catch (error) {
      // A provider that throws something that is not a ProviderError still has
      // to be quarantinable, or one malformed response shape would take a
      // provider out of rotation forever.
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError(error instanceof Error ? error.message : String(error), {
              provider: provider.id,
              kind: "unknown",
              cause: error
            });

      breaker.recordFailure(provider.id, failure.kind, failure.retryAfterMs, failure.scope);
      failures.push(`${provider.id}: ${failure.kind}${failure.status ? ` (${failure.status})` : ""}`);
      kinds.push(failure.kind);

      console.warn(
        `[ai] "${provider.id}" failed with ${failure.kind}${failure.status ? ` (${failure.status})` : ""}; trying the next provider`,
        failure.message
      );
      // Deliberately no branch here. Even a `bad_request` gets the next
      // provider: the request shape is identical across providers, so a 400
      // usually means a model name we got wrong and the next one may spell it
      // correctly. If every provider rejects it, the caller still sees a real
      // error from the throw below.
    }
  }

  // The wrapper's own `kind` is only a summary for a caller that did not read
  // `kinds`. It reports "unknown" for a mixed outage on purpose: one provider
  // out of budget and one misconfigured has no single honest label, and
  // guessing "rate_limited" would invite a "just wait and retry" response to a
  // problem that waiting cannot fix.
  throw new ProviderError(`Todos los proveedores fallaron: ${failures.join("; ")}`, {
    provider: "chain",
    kind: kinds.length > 0 && kinds.every((kind) => kind === "rate_limited") ? "rate_limited" : "unknown",
    kinds
  });
}

export function providerHealth(): ProviderHealth[] {
  return breaker.snapshot();
}

/**
 * Forget every recorded failure.
 *
 * Only useful in tests, and in the one operational case that needs it: a bad
 * key was just fixed, and the ten-minute auth quarantine would otherwise keep
 * the provider out of rotation on a lambda that is still warm from before.
 */
export function resetProviderHealth(): void {
  breaker.reset();
}

/**
 * Reasoning off for the cheap tier, on for the rest.
 *
 * This is not only a cost knob. The one time Milo shipped a blank chat bubble,
 * the cause was gpt-oss spending all 1200 tokens on internal reasoning and
 * returning no content at all — the same overrun that truncates a
 * `TASKS_ACTION` array into invalid JSON. The callers already marked "fast"
 * are the ones producing short mechanical output (a memory summary, a stat
 * blurb, a suggested breakdown), which is exactly the work that does not need
 * to think first.
 */
function resolveReasoningEffort(
  provider: { supportsReasoningEffort?: boolean },
  tier: ModelTier
): ProviderRequest["reasoningEffort"] {
  if (!provider.supportsReasoningEffort) return undefined;
  return tier === "fast" ? "none" : undefined;
}

export { MAX_ATTEMPTS };
