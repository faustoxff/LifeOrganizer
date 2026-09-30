import "server-only";
import Groq from "groq-sdk";
import {
  type ChatMessage,
  type Completion,
  classifyFailure,
  parseRetryAfterHint,
  ProviderError,
  rateLimitScope,
  type TokenUsage
} from "@/lib/ai/types";
import type { ProviderAdapter, ProviderRequest } from "@/lib/ai/types";
import { readToolCalls, toWireMessages, toWireTools } from "@/lib/ai/tool-wire";

/**
 * Groq keeps the SDK it always had. Swapping it for the OpenAI-compatible
 * endpoint would be less code, but it would also be a silent behaviour change
 * on the provider that currently works, on the same day the chain lands.
 */
export const groqProvider: ProviderAdapter = {
  id: "groq",
  label: "Groq",
  supportsReasoningEffort: false,
  supportsVision: false,

  // Both default models (qwen3 and gpt-oss) call tools on Groq. GROQ_TOOLS=off is the
  // escape hatch if a model swap breaks it: chat drops to the TASKS_ACTION text path.
  supportsTools() {
    return process.env.GROQ_TOOLS !== "off";
  },

  configured() {
    return Boolean(process.env.GROQ_API_KEY);
  },

  modelFor(tier) {
    if (tier === "fast") {
      return process.env.GROQ_FAST_MODEL ?? process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
    }
    if (tier === "pro") {
      return process.env.GROQ_PRO_MODEL ?? "openai/gpt-oss-120b";
    }
    if (tier === "planner") {
      return process.env.GROQ_PLANNER_MODEL ?? process.env.GROQ_PRO_MODEL ?? "openai/gpt-oss-120b";
    }
    return process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
  },

  async complete(request: ProviderRequest): Promise<Completion> {
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    try {
      const response = await client.chat.completions.create(
        {
          model: request.model,
          messages: toWireMessages(request.messages) as Groq.Chat.ChatCompletionMessageParam[],
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          ...(request.tools?.length
            ? {
                tools: toWireTools(request.tools) as Groq.Chat.ChatCompletionTool[],
                tool_choice: request.toolChoice ?? "auto"
              }
            : {})
        },
        { signal: AbortSignal.timeout(request.timeoutMs) }
      );

      const choice = response.choices[0];
      const usage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0
      };

      return {
        content: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? null,
        toolCalls: readToolCalls(choice?.message?.tool_calls),
        model: response.model ?? request.model,
        provider: "groq",
        usage
      };
    } catch (error) {
      throw toProviderError("groq", error);
    }
  }
};

export function toProviderError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : undefined;

  return new ProviderError(message, {
    provider,
    kind: classifyFailure({
      status: Number.isFinite(status) ? status : undefined,
      name,
      message
    }),
    status: Number.isFinite(status) ? status : undefined,
    retryAfterMs: parseRetryAfterHint(message),
    // Groq answers all four of its ceilings with "Rate limit reached". Which
    // one it was decides whether the provider recovers in seconds or not until
    // midnight, so the wording has to be read rather than discarded.
    scope: rateLimitScope(message),
    cause: error
  });
}

export type { ChatMessage };
