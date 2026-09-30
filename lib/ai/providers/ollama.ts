import "server-only";
import { createOpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";

/**
 * Ollama Cloud.
 *
 * It exists in this chain for one concrete reason: Groq's free plan gives
 * 200,000 tokens per day per model, which measured against the real traffic is
 * about 130 chat turns for the entire product before everyone gets a 429 at
 * the same moment. Ollama is pay-as-you-go with no daily cliff and runs
 * `gpt-oss:120b` — the same model the Pro plan already uses — at $0.15/M input
 * and $0.60/M output, which is roughly half a tenth of a cent per turn.
 *
 * It is not a magic fix for the 961-token prompt: that is still paid for on
 * every provider. What it removes is the cliff.
 */
export const ollamaProvider = createOpenAICompatibleProvider({
  id: "ollama",
  label: "Ollama Cloud",
  baseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1",
  apiKeyEnv: "OLLAMA_API_KEY",
  supportsReasoningEffort: true,
  models: {
    fast: process.env.OLLAMA_FAST_MODEL ?? "gpt-oss:20b",
    standard: process.env.OLLAMA_MODEL ?? "gpt-oss:120b",
    pro: process.env.OLLAMA_PRO_MODEL ?? "gpt-oss:120b",
    planner: process.env.OLLAMA_PLANNER_MODEL ?? process.env.OLLAMA_PRO_MODEL ?? "gpt-oss:120b"
  }
});
