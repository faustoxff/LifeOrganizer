import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete, providerHealth, resetProviderHealth } from "@/lib/ai/complete";
import { rotateAfter } from "@/lib/ai/registry";
import {
  type Completion,
  type ModelTier,
  ProviderError,
  type ProviderAdapter,
  type ProviderRequest
} from "@/lib/ai/types";

/**
 * The chain is what turns "Groq ran out of daily budget" from an outage into a
 * slow request. These tests drive it with fake providers, so every case here is
 * one that would otherwise cost a real API call to observe.
 *
 * The breaker is module-level state keyed by provider id, so each case uses its
 * own ids. That is also the honest reason these tests are separate from the
 * real ones: they do not exercise the actual Groq or Ollama adapters.
 */

let callCount = 0;

/** A provider whose behaviour each case dictates, tracked by call count. */
function fakeProvider(options: {
  id: string;
  model?: string;
  failWith?: FailureSpec;
  configured?: boolean;
}): ProviderAdapter {
  const id = options.id;
  return {
    id,
    label: id,
    configured: () => options.configured ?? true,
    modelFor: (tier: ModelTier) => `${id}:${tier}`,
    async complete(_request: ProviderRequest): Promise<Completion> {
      callCount += 1;
      if (options.failWith) throw providerFailure(id, options.failWith);
      return {
        content: `respuesta de ${id}`,
        finishReason: "stop",
        model: `${id}:standard`,
        provider: id,
        usage: { inputTokens: 10, outputTokens: 5 }
      };
    }
  };
}

type FailureSpec = { kind: ProviderError["kind"]; status?: number };

function providerFailure(id: string, spec: FailureSpec): ProviderError {
  return new ProviderError(`${id} falló`, { provider: id, ...spec });
}

const request = (overrides: Partial<Parameters<typeof complete>[0]> = {}) => ({
  messages: [{ role: "user" as const, content: "hola" }],
  tier: "standard" as ModelTier,
  timeoutMs: 1000,
  ...overrides
});

beforeEach(() => {
  callCount = 0;
  resetProviderHealth();
});

describe("complete: chain order", () => {
  it("answers from the first provider when it works", async () => {
    const first = fakeProvider({ id: "a-first" });
    const second = fakeProvider({ id: "b-second" });

    const result = await complete({ ...request(), providers: [first, second] });

    expect(result.provider).toBe("a-first");
    // The whole point of ordering: no reason to spend the second provider.
    expect(callCount).toBe(1);
  });

  it("falls through to the next provider when the first is out of budget", async () => {
    // This is the failure that motivated the chain: 200k tokens per day, gone.
    const groq = fakeProvider({ id: "groq", failWith: { kind: "rate_limited", status: 429 } });
    const ollama = fakeProvider({ id: "ollama" });

    const result = await complete({ ...request(), providers: [groq, ollama] });

    expect(result.provider).toBe("ollama");
    expect(result.content).toBe("respuesta de ollama");
    expect(callCount).toBe(2);
  });

  it("keeps walking the chain past several failures", async () => {
    const result = await complete({
      ...request(),
      providers: [
        fakeProvider({ id: "p1", failWith: { kind: "rate_limited", status: 429 } }),
        fakeProvider({ id: "p2", failWith: { kind: "timeout" } }),
        fakeProvider({ id: "p3", failWith: { kind: "server", status: 503 } }),
        fakeProvider({ id: "p4" })
      ]
    });

    expect(result.provider).toBe("p4");
  });

  it("skips a provider with no key without spending a request", async () => {
    const result = await complete({
      ...request(),
      providers: [fakeProvider({ id: "no-key", configured: false }), fakeProvider({ id: "ok" })]
    });

    expect(result.provider).toBe("ok");
    expect(callCount).toBe(1);
  });

  it("honours an explicit order over the default chain", async () => {
    const groq = fakeProvider({ id: "groq" });
    const ollama = fakeProvider({ id: "ollama" });

    const result = await complete({
      ...request(),
      providers: [groq, ollama],
      order: ["ollama"]
    });

    expect(result.provider).toBe("ollama");
  });

  it("fails clearly when nothing is configured", async () => {
    await expect(
      complete({
        ...request(),
        providers: [fakeProvider({ id: "x", configured: false })]
      })
    ).rejects.toThrow(/ningún proveedor/i);
  });
});

describe("complete: circuit breaker integration", () => {
  it("stops calling a provider that keeps refusing", async () => {
    const groq = fakeProvider({ id: "groq", failWith: { kind: "rate_limited", status: 429 } });
    const ollama = fakeProvider({ id: "ollama" });
    const providers = [groq, ollama];

    // The threshold is deliberate: one 429 is a blip and the fallback answers,
    // so the breaker waits for a pattern before cutting the provider off. The
    // turn that trips it still pays for the failed call.
    await complete({ ...request(), providers });
    expect(callCount).toBe(2);
    expect(providerHealth().find((p) => p.provider === "groq")?.state).toBe("closed");

    await complete({ ...request(), providers });
    expect(callCount).toBe(4);
    expect(providerHealth().find((p) => p.provider === "groq")?.state).toBe("open");

    // Quarantined from here on: no wasted round trip per user request.
    await complete({ ...request(), providers });
    expect(callCount).toBe(5);
  });

  it("still answers from the healthy provider while another is quarantined", async () => {
    const groq = fakeProvider({ id: "groq", failWith: { kind: "rate_limited", status: 429 } });
    const ollama = fakeProvider({ id: "ollama" });

    await complete({ ...request(), providers: [groq, ollama] });
    const second = await complete({ ...request(), providers: [groq, ollama] });

    // One dead provider is not a dead app. This is the guarantee the user
    // actually feels.
    expect(second.content).toBe("respuesta de ollama");
  });

  it("does not quarantine a provider over a malformed request", async () => {
    // A 400 is our bug. Tripping on it would remove a working provider from
    // rotation and make the app fail for longer than the bug does.
    const groq = fakeProvider({ id: "groq", failWith: { kind: "bad_request", status: 400 } });
    const ollama = fakeProvider({ id: "ollama" });

    await complete({ ...request(), providers: [groq, ollama] });
    await complete({ ...request(), providers: [groq, ollama] });

    const health = providerHealth().find((p) => p.provider === "groq");
    expect(health?.state).toBe("closed");
    // Counted, but not treated as a reason to take it out of rotation.
    expect(health?.failures).toBe(2);
    expect(health?.consecutiveFailures).toBe(0);
  });
});

describe("complete: failure reporting", () => {
  it("carries every kind so the route can tell busy from broken", async () => {
    const error = await complete({
      ...request(),
      providers: [
        fakeProvider({ id: "a", failWith: { kind: "rate_limited", status: 429 } }),
        fakeProvider({ id: "b", failWith: { kind: "rate_limited", status: 429 } })
      ]
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    const chainError = error as ProviderError;
    // Both providers were out of capacity, so the user should be told Milo is
    // busy, not that the connection broke.
    expect(chainError.kinds).toEqual(["rate_limited", "rate_limited"]);
    expect(chainError.kind).toBe("rate_limited");
  });

  it("does not report a capacity problem when one provider is misconfigured", async () => {
    // Busy is a retryable story; a bad request is our bug and needs a different
    // fix, so it must not be laundered into "busy".
    const error = await complete({
      ...request(),
      providers: [
        fakeProvider({ id: "a", failWith: { kind: "rate_limited", status: 429 } }),
        fakeProvider({ id: "b", failWith: { kind: "bad_request", status: 400 } })
      ]
    }).catch((e: unknown) => e);

    const chainError = error as ProviderError;
    expect(chainError.kinds).toEqual(["rate_limited", "bad_request"]);
    expect(chainError.kind).toBe("unknown");
  });

  it("names the providers it tried", async () => {
    const error = await complete({
      ...request(),
      providers: [
        fakeProvider({ id: "groq", failWith: { kind: "rate_limited", status: 429 } }),
        fakeProvider({ id: "ollama", failWith: { kind: "auth", status: 401 } })
      ]
    }).catch((e: unknown) => e);

    const message = (error as ProviderError).message;
    expect(message).toContain("groq");
    expect(message).toContain("ollama");
  });

  it("treats a non-ProviderError throw as a failure rather than crashing the chain", async () => {
    // A malformed response shape must not take a provider out of rotation
    // forever, and must not stop the chain from trying the next one.
    const broken: ProviderAdapter = {
      id: "broken",
      label: "broken",
      configured: () => true,
      modelFor: () => "broken",
      complete: async () => {
        throw new Error("Cannot read properties of undefined");
      }
    };

    const result = await complete({ ...request(), providers: [broken, fakeProvider({ id: "ok" })] });
    expect(result.provider).toBe("ok");
  });
});

describe("rotateAfter", () => {
  it("moves the chain to start after the provider that failed", async () => {
    // A starved reply is a property of one model. Retrying the same engine tends
    // to produce the same empty answer, so the retry starts elsewhere.
    const groq = fakeProvider({ id: "groq" });
    const ollama = fakeProvider({ id: "ollama" });

    const first = await complete({ ...request(), providers: [groq, ollama] });
    const retry = await complete({
      ...request(),
      providers: [groq, ollama],
      order: rotateAfter(first.provider)
    });

    expect(retry.provider).toBe("ollama");
  });

  it("returns the full chain when the provider is not in it", () => {
    const order = rotateAfter("not-a-provider");
    expect(order.length).toBeGreaterThan(0);
  });
});

describe("chat failure classification", () => {
  it("calls an all-capacity outage busy", async () => {
    const { classifyChatFailure } = await import("@/lib/milo");
    const error = new ProviderError("x", {
      provider: "chain",
      kind: "rate_limited",
      kinds: ["rate_limited", "rate_limited"]
    });

    expect(classifyChatFailure(error)).toMatchObject({ busy: true, timedOut: false });
  });

  it("does not call a mixed outage busy", async () => {
    const { classifyChatFailure } = await import("@/lib/milo");
    const error = new ProviderError("x", {
      provider: "chain",
      kind: "unknown",
      kinds: ["rate_limited", "auth"]
    });

    expect(classifyChatFailure(error).busy).toBe(false);
  });

  it("recognises an all-timeout outage", async () => {
    const { classifyChatFailure } = await import("@/lib/milo");
    const error = new ProviderError("x", {
      provider: "chain",
      kind: "unknown",
      kinds: ["timeout", "timeout"]
    });

    expect(classifyChatFailure(error).timedOut).toBe(true);
  });

  it("handles a non-provider error without claiming anything", async () => {
    const { classifyChatFailure } = await import("@/lib/milo");
    const failure = classifyChatFailure(new Error("boom"));

    expect(failure).toMatchObject({ busy: false, timedOut: false });
  });
});

describe("tier planner", () => {
  it("cae en el modelo pro cuando no hay uno propio, y se puede sobrescribir", async () => {
    const { groqProvider } = await import("@/lib/ai/providers/groq");
    const { ollamaProvider } = await import("@/lib/ai/providers/ollama");
    const saved = { g: process.env.GROQ_PLANNER_MODEL, o: process.env.OLLAMA_PLANNER_MODEL };
    delete process.env.GROQ_PLANNER_MODEL;
    try {
      expect(groqProvider.modelFor("planner")).toBe(groqProvider.modelFor("pro"));
      process.env.GROQ_PLANNER_MODEL = "modelo-grande";
      expect(groqProvider.modelFor("planner")).toBe("modelo-grande");
      expect(groqProvider.modelFor("pro")).not.toBe("modelo-grande");
      expect(ollamaProvider.modelFor("planner")).toBeTruthy();
    } finally {
      if (saved.g === undefined) delete process.env.GROQ_PLANNER_MODEL; else process.env.GROQ_PLANNER_MODEL = saved.g;
      if (saved.o === undefined) delete process.env.OLLAMA_PLANNER_MODEL; else process.env.OLLAMA_PLANNER_MODEL = saved.o;
    }
  });

  it("ningún proveedor declara visión, así que el flujo de proyectos deja las imágenes afuera", async () => {
    const { chainSupportsVision } = await import("@/lib/ai/registry");
    expect(chainSupportsVision()).toBe(false);
  });
});
