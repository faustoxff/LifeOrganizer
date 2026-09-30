import "server-only";
import { complete as realComplete } from "@/lib/ai/complete";
import { rotateAfter } from "@/lib/ai/registry";
import { type AgentMessage, type Completion, type CompletionRequest, type ModelTier, ProviderError } from "@/lib/ai/types";
import { buildChatMessages } from "@/lib/milo";
import { executeTool, MILO_TOOLS, type ToolContext } from "@/lib/milo-tools";
import { stripTaskBlock } from "@/lib/task-actions";
import type { FactProposal, SavedFact, WeekProposal } from "@/types/milo";
import type { TaskInput } from "@/types/task";

/**
 * Un turno de Milo con tools: el modelo llama herramientas, el servidor las valida y las
 * ejecuta, y el modelo escribe la respuesta. Como mucho MAX_ROUNDS idas y vueltas; la
 * última va con `tool_choice: none` para que responda en texto sí o sí.
 *
 * Todo el turno cuenta como UN uso de `milo_chat`: las rondas son un detalle interno.
 */

export const MAX_ROUNDS = 4;
/** Llamadas que se ejecutan por ronda. Más que esto es un modelo fuera de control. */
export const MAX_CALLS_PER_ROUND = 6;
const AGENT_MAX_TOKENS = 2000;

/** Si el modelo propuso algo pero no escribió nada, esto es lo que se muestra. */
export const DEFAULT_PROPOSAL_TEXT = "Te dejo esta propuesta para que la confirmes. Si querés cambiar algo, decime.";
export const DEFAULT_ITEMS_TEXT = "Te dejo esto para que lo confirmes. Si querés cambiar algo, decime.";
export const DEFAULT_EMPTY_TEXT = "No pude armar la respuesta. ¿Me lo repetís?";
export const DEFAULT_FACT_TEXT = "Anotado, lo tengo en cuenta.";
export const DEFAULT_FACT_PROPOSAL_TEXT = "¿Querés que me acuerde de eso? Confirmalo abajo.";

export type AgentParams = {
  message: string;
  contextStatic: string;
  context: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  isPro: boolean;
  tools: ToolContext;
  timeoutMs?: number;
};

export type AgentResult = {
  /** La respuesta para el usuario, sin ningún resto de formato de máquina. */
  text: string;
  /** Ítems para confirmar. Vacío si no se propuso nada. */
  taskActions: TaskInput[];
  proposal: WeekProposal | null;
  /** Datos que el usuario dijo y quedaron guardados en este turno. */
  factsSaved: SavedFact[];
  /** Datos que Milo dedujo: esperan la confirmación del usuario, no están guardados. */
  factProposals: FactProposal[];
  /** Nombres de las tools que se ejecutaron, en orden. Para logs y evals. */
  toolsUsed: string[];
  /** Lo mismo con los argumentos que mandó el modelo (para evals: ¿pasó el tiempo que dijo el usuario?). */
  toolCalls: { name: string; arguments: string }[];
  rounds: number;
  provider: string;
  model: string;
};

export type AgentDeps = {
  complete: (request: CompletionRequest) => Promise<Completion>;
  buildMessages: typeof buildChatMessages;
};

const realDeps: AgentDeps = { complete: realComplete, buildMessages: buildChatMessages };

export async function runMiloAgent(params: AgentParams, deps: AgentDeps = realDeps): Promise<AgentResult> {
  const tier: ModelTier = params.isPro ? "pro" : "standard";
  const timeoutMs = params.timeoutMs ?? 30000;
  const messages: AgentMessage[] = await deps.buildMessages({
    message: params.message,
    context: params.context,
    contextStatic: params.contextStatic,
    history: params.history,
    isPro: params.isPro
  });

  let taskActions: TaskInput[] = [];
  let proposal: WeekProposal | null = null;
  const factsSaved: SavedFact[] = [];
  const factProposals: FactProposal[] = [];
  const toolsUsed: string[] = [];
  const toolCalls: { name: string; arguments: string }[] = [];
  let provider = "";
  let model = "";
  // Después de proponer, la próxima ronda solo tiene que escribir la respuesta.
  let writeReply = false;
  let rounds = 0;

  const done = (text: string): AgentResult => ({
    text: text.trim() || fallbackText(taskActions, proposal, factsSaved, factProposals),
    taskActions,
    proposal,
    factsSaved,
    factProposals,
    toolsUsed,
    toolCalls,
    rounds,
    provider,
    model
  });

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    rounds = round;
    const finalRound = round === MAX_ROUNDS || writeReply;

    let response: Completion;
    try {
      response = await deps.complete({
        messages,
        tier,
        timeoutMs,
        maxTokens: AGENT_MAX_TOKENS,
        tools: MILO_TOOLS,
        toolChoice: finalRound ? "none" : "auto"
      });
    } catch (error) {
      // Si ya se propuso algo, eso vale más que un error: se devuelve con un texto por defecto.
      if (round > 1 && (taskActions.length > 0 || proposal || factsSaved.length > 0 || factProposals.length > 0)) {
        console.warn(`[milo] round ${round} failed after a proposal, returning it as is`, error);
        return done("");
      }
      throw error;
    }
    provider = response.provider;
    model = response.model;

    const calls = response.toolCalls ?? [];
    if (calls.length === 0 || finalRound) {
      let text = response.content;
      // Un modelo que se quedó sin presupuesto pensando devuelve vacío. Un reintento en otro
      // proveedor lo arregla casi siempre; si ya hay una propuesta no hace falta.
      if (text.trim() === "" && taskActions.length === 0 && !proposal && factsSaved.length === 0 && factProposals.length === 0) {
        text = await retryEmpty(deps, { messages, tier, timeoutMs }, response.provider);
      }
      return done(stripTaskBlock(text));
    }

    messages.push({ role: "assistant", content: response.content, toolCalls: calls });

    let asked: string | null = null;
    for (const call of calls.slice(0, MAX_CALLS_PER_ROUND)) {
      const outcome = await executeTool(call, params.tools);
      messages.push({ role: "tool", toolCallId: call.id, content: outcome.content });
      if (outcome.isError) continue;
      toolsUsed.push(call.name);
      toolCalls.push({ name: call.name, arguments: call.arguments });

      const effect = outcome.effect;
      if (effect?.ask) asked = effect.ask;
      if (effect?.factSaved && !factsSaved.some((f) => f.key === effect.factSaved!.key)) factsSaved.push(effect.factSaved);
      if (effect?.factProposal && !factProposals.some((f) => f.key === effect.factProposal!.key)) factProposals.push(effect.factProposal);
      if (effect?.proposal) {
        proposal = effect.proposal;
        taskActions = effect.taskActions ?? [];
        writeReply = true;
      } else if (effect?.taskActions) {
        // Una propuesta nueva reemplaza a la anterior, sea del tipo que sea.
        proposal = null;
        taskActions = effect.taskActions;
        writeReply = true;
      }
    }
    // Las llamadas que sobraron igual reciben respuesta: un tool_call sin resultado rompe la conversación.
    for (const extra of calls.slice(MAX_CALLS_PER_ROUND)) {
      messages.push({
        role: "tool",
        toolCallId: extra.id,
        content: JSON.stringify({ ok: false, error: `Solo se ejecutan ${MAX_CALLS_PER_ROUND} llamadas por ronda.` })
      });
    }

    // Una pregunta cierra el turno: la respuesta ES la pregunta. No se gasta otra ronda.
    if (asked) {
      taskActions = [];
      proposal = null;
      return done(asked);
    }
  }

  // Inalcanzable: la última ronda siempre retorna. Por las dudas, sin colgarse.
  return done("");
}

function fallbackText(
  taskActions: TaskInput[],
  proposal: WeekProposal | null,
  factsSaved: SavedFact[],
  factProposals: FactProposal[]
): string {
  if (proposal) return DEFAULT_PROPOSAL_TEXT;
  if (taskActions.length > 0) return DEFAULT_ITEMS_TEXT;
  if (factProposals.length > 0) return DEFAULT_FACT_PROPOSAL_TEXT;
  if (factsSaved.length > 0) return DEFAULT_FACT_TEXT;
  return DEFAULT_EMPTY_TEXT;
}

async function retryEmpty(
  deps: AgentDeps,
  base: { messages: AgentMessage[]; tier: ModelTier; timeoutMs: number },
  failedProvider: string
): Promise<string> {
  try {
    const retry = await deps.complete({
      messages: base.messages,
      tier: base.tier === "pro" ? "standard" : "pro",
      timeoutMs: base.timeoutMs,
      maxTokens: AGENT_MAX_TOKENS,
      order: rotateAfter(failedProvider),
      tools: MILO_TOOLS,
      toolChoice: "none"
    });
    return retry.content;
  } catch (error) {
    console.warn(`[milo] retry after an empty reply failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

/**
 * Whether a failure means "this chain cannot do tools" rather than "this call failed":
 * every provider refused the request as malformed (or none could take tools at all).
 * The route answers those by falling back to the TASKS_ACTION text path.
 */
export function toolsNotSupported(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const kinds = error.kinds ?? [error.kind];
  return kinds.length > 0 && kinds.every((kind) => kind === "bad_request");
}
