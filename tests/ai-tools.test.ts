import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/ai/complete";
import { createOpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";
import { readToolCalls, toWireMessages, toWireTools } from "@/lib/ai/tool-wire";
import type { Completion, ProviderAdapter, ProviderRequest, ToolSpec } from "@/lib/ai/types";

/**
 * Tool calling across the chain. What matters: the wire format is right, a provider
 * that cannot take tools is skipped rather than tried, and a chain with no
 * tool-capable provider fails in a way the chat can turn into the text fallback.
 */

const TOOL: ToolSpec = {
  name: "create_items",
  description: "propone",
  parameters: { type: "object", properties: { items: { type: "array" } }, required: ["items"] }
};

describe("wire format", () => {
  it("maps an assistant tool turn and its result", () => {
    const wire = toWireMessages([
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_schedule", arguments: '{"from":"a"}' }] },
      { role: "tool", toolCallId: "c1", content: '{"ok":true}' }
    ]);
    expect(wire[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "get_schedule", arguments: '{"from":"a"}' } }]
    });
    expect(wire[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"ok":true}' });
    expect(wire[0]).toEqual({ role: "system", content: "s" });
  });

  it("wraps tool specs as functions", () => {
    expect(toWireTools([TOOL])).toEqual([
      { type: "function", function: { name: "create_items", description: "propone", parameters: TOOL.parameters } }
    ]);
  });

  it("reads tool calls defensively", () => {
    expect(readToolCalls(undefined)).toBeUndefined();
    expect(readToolCalls([])).toBeUndefined();
    expect(readToolCalls([{ function: { arguments: "{}" } }, null, "x"])).toBeUndefined();
    const calls = readToolCalls([
      { id: "a", function: { name: "ask_user", arguments: '{"question":"?"}' } },
      { function: { name: "get_schedule", arguments: { from: "x" } } }
    ]);
    expect(calls).toEqual([
      { id: "a", name: "ask_user", arguments: '{"question":"?"}' },
      { id: "call_1", name: "get_schedule", arguments: '{"from":"x"}' }
    ]);
  });
});

function fake(id: string, tools: boolean, calls: { n: number }): ProviderAdapter {
  return {
    id,
    label: id,
    configured: () => true,
    modelFor: (tier) => `${id}:${tier}`,
    ...(tools ? { supportsTools: () => true } : {}),
    async complete(request: ProviderRequest): Promise<Completion> {
      calls.n += 1;
      return {
        content: "",
        finishReason: "tool_calls",
        toolCalls: request.tools ? [{ id: "1", name: "create_items", arguments: "{}" }] : undefined,
        model: id,
        provider: id,
        usage: { inputTokens: 1, outputTokens: 1 }
      };
    }
  };
}

const base = { messages: [{ role: "user" as const, content: "hola" }], tier: "standard" as const, timeoutMs: 1000 };

describe("complete() with tools", () => {
  it("skips a provider without tool support and uses the next one", async () => {
    const a = { n: 0 };
    const b = { n: 0 };
    const result = await complete({ ...base, tools: [TOOL], providers: [fake("tt-a", false, a), fake("tt-b", true, b)] });
    expect(result.provider).toBe("tt-b");
    expect(a.n).toBe(0);
    expect(result.toolCalls?.[0].name).toBe("create_items");
  });

  it("fails as bad_request when no provider supports tools, without calling any", async () => {
    const a = { n: 0 };
    await expect(complete({ ...base, tools: [TOOL], providers: [fake("tt-c", false, a)] })).rejects.toMatchObject({
      kind: "bad_request",
      kinds: ["bad_request"]
    });
    expect(a.n).toBe(0);
  });

  it("does not need tool support when no tools are sent", async () => {
    const a = { n: 0 };
    const result = await complete({ ...base, providers: [fake("tt-d", false, a)] });
    expect(result.provider).toBe("tt-d");
  });
});

describe("openai-compatible adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends tools and reads tool_calls back", async () => {
    process.env.TT_KEY = "k";
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            model: "m",
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [{ id: "x", type: "function", function: { name: "ask_user", arguments: '{"question":"¿cuándo?"}' } }]
                }
              }
            ],
            usage: { prompt_tokens: 3, completion_tokens: 4 }
          })
        );
      })
    );
    const provider = createOpenAICompatibleProvider({
      id: "tt",
      label: "TT",
      baseUrl: "http://x",
      apiKeyEnv: "TT_KEY",
      models: { fast: "m", standard: "m", pro: "m", planner: "m" },
      supportsTools: () => true
    });
    const out = await provider.complete({
      messages: [{ role: "user", content: "hola" }],
      model: "m",
      maxTokens: 10,
      temperature: 0,
      timeoutMs: 1000,
      tier: "standard",
      tools: [TOOL],
      toolChoice: "none"
    });
    expect(sent.tools).toHaveLength(1);
    expect(sent.tool_choice).toBe("none");
    expect(out.toolCalls).toEqual([{ id: "x", name: "ask_user", arguments: '{"question":"¿cuándo?"}' }]);
    expect(out.content).toBe("");
    delete process.env.TT_KEY;
  });

  it("sends no tool fields when there are no tools", async () => {
    process.env.TT_KEY = "k";
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "hola" }, finish_reason: "stop" }] }));
      })
    );
    const provider = createOpenAICompatibleProvider({
      id: "tt",
      label: "TT",
      baseUrl: "http://x",
      apiKeyEnv: "TT_KEY",
      models: { fast: "m", standard: "m", pro: "m", planner: "m" }
    });
    const out = await provider.complete({
      messages: [{ role: "user", content: "hola" }],
      model: "m",
      maxTokens: 10,
      temperature: 0,
      timeoutMs: 1000,
      tier: "standard"
    });
    expect("tools" in sent).toBe(false);
    expect(out.toolCalls).toBeUndefined();
    delete process.env.TT_KEY;
  });
});

describe("ollama tool support", () => {
  afterEach(() => {
    delete process.env.OLLAMA_TOOLS;
    vi.resetModules();
  });

  it("is on for gpt-oss and off for other models unless forced", async () => {
    const { ollamaProvider } = await import("@/lib/ai/providers/ollama");
    expect(ollamaProvider.supportsTools?.("gpt-oss:120b")).toBe(true);
    expect(ollamaProvider.supportsTools?.("llama3:8b")).toBe(false);
    process.env.OLLAMA_TOOLS = "on";
    expect(ollamaProvider.supportsTools?.("llama3:8b")).toBe(true);
    process.env.OLLAMA_TOOLS = "off";
    expect(ollamaProvider.supportsTools?.("gpt-oss:120b")).toBe(false);
  });
});
