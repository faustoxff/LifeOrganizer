import type { AgentMessage, ToolCall, ToolSpec } from "@/lib/ai/types";

/**
 * The OpenAI chat-completions wire format for tools, which Groq and Ollama Cloud
 * both speak. Kept apart from the adapters (and free of `server-only`) so the
 * mapping is testable without a network and the two adapters cannot drift.
 */

type WireToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toWireMessages(messages: readonly AgentMessage[]): WireMessage[] {
  return messages.map((message): WireMessage => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant" && "toolCalls" in message) {
      return {
        role: "assistant",
        // Some providers reject an empty string next to tool_calls; null is the spec's way.
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments }
        }))
      };
    }
    return { role: message.role as "system" | "user" | "assistant", content: message.content } as WireMessage;
  });
}

export function toWireTools(tools: readonly ToolSpec[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

/** Reads `message.tool_calls` defensively: a malformed entry is dropped, never thrown on. */
export function readToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const calls: ToolCall[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const fn = (entry as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (!fn || typeof fn.name !== "string" || !fn.name) return;
    const id = (entry as { id?: unknown }).id;
    calls.push({
      id: typeof id === "string" && id ? id : `call_${index}`,
      name: fn.name,
      // Some providers hand back an object instead of a JSON string.
      arguments:
        typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {})
    });
  });
  return calls.length > 0 ? calls : undefined;
}
