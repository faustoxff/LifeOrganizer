import "server-only";
import {
  classifyFailure,
  type Completion,
  parseRetryAfterHint,
  ProviderError,
  rateLimitScope,
  type TokenUsage
} from "@/lib/ai/types";
import type { ModelTier, ProviderAdapter, ProviderRequest } from "@/lib/ai/types";
import { readToolCalls, toWireMessages, toWireTools } from "@/lib/ai/tool-wire";

/**
 * Factory for any provider that speaks the OpenAI chat-completions dialect.
 *
 * Ollama Cloud is one. OpenRouter is one, and adding it later is a config
 * object rather than a third adapter — which is the point of writing the chain
 * at all.
 */
export function createOpenAICompatibleProvider(config: {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: Record<ModelTier, string>;
  /** Send `reasoning_effort` when the caller sets one. */
  supportsReasoningEffort?: boolean;
  extraHeaders?: Record<string, string>;
  /** Whether `model` can be sent tools. Absent = never. */
  supportsTools?: (model: string) => boolean;
}): ProviderAdapter {
  return {
    id: config.id,
    label: config.label,
    supportsReasoningEffort: config.supportsReasoningEffort ?? false,
    ...(config.supportsTools ? { supportsTools: config.supportsTools } : {}),

    configured() {
      return Boolean(process.env[config.apiKeyEnv]);
    },

    modelFor(tier: ModelTier) {
      return config.models[tier] ?? config.models.standard;
    },

    async complete(request: ProviderRequest): Promise<Completion> {
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) {
        // Reported as an auth failure rather than thrown raw so the chain treats
        // it like any other unusable provider instead of crashing the turn.
        throw new ProviderError(`${config.label} is not configured (${config.apiKeyEnv} is unset)`, {
          provider: config.id,
          kind: "auth"
        });
      }

      const body: Record<string, unknown> = {
        model: request.model,
        messages: toWireMessages(request.messages),
        temperature: request.temperature,
        max_tokens: request.maxTokens
      };
      if (request.tools?.length) {
        body.tools = toWireTools(request.tools);
        body.tool_choice = request.toolChoice ?? "auto";
      }
      if (config.supportsReasoningEffort && request.reasoningEffort !== undefined) {
        body.reasoning_effort = request.reasoningEffort;
      }

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...config.extraHeaders
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeoutMs)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const name = error instanceof Error ? error.name : undefined;
        throw new ProviderError(message, {
          provider: config.id,
          kind: classifyFailure({ name, message }),
          cause: error
        });
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ProviderError(
          text || `${config.label} responded ${response.status}`,
          {
            provider: config.id,
            kind: classifyFailure({ status: response.status, message: text }),
            status: response.status,
            retryAfterMs: parseRetryAfterHint(text) ?? retryAfterHeaderMs(response),
            scope: rateLimitScope(text)
          }
        );
      }

      const payload = (await response.json()) as {
        model?: string;
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: unknown };
          finish_reason?: string | null;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const choice = payload.choices?.[0];
      const usage: TokenUsage = {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0
      };

      return {
        content: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? null,
        toolCalls: readToolCalls(choice?.message?.tool_calls),
        model: payload.model ?? request.model,
        provider: config.id,
        usage
      };
    }
  };
}

function retryAfterHeaderMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
