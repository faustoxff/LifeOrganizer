import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import type { Completion, CompletionRequest, ToolCall } from "@/lib/ai/types";
import { ProviderError } from "@/lib/ai/types";
import {
  DEFAULT_EMPTY_TEXT,
  DEFAULT_ITEMS_TEXT,
  DEFAULT_PROPOSAL_TEXT,
  MAX_CALLS_PER_ROUND,
  MAX_ROUNDS,
  runMiloAgent,
  toolsNotSupported,
  type AgentDeps
} from "@/lib/milo-agent";
import type { ToolContext } from "@/lib/milo-tools";

const NOW = new Date("2026-09-28T12:00:00.000Z");

type Step = { content?: string; calls?: Array<{ name: string; args: unknown }> } | Error;

/** Un modelo guionado: cada `complete()` consume el próximo paso y queda registrado. */
function script(steps: Step[]) {
  const requests: CompletionRequest[] = [];
  let i = 0;
  const complete = vi.fn(async (request: CompletionRequest): Promise<Completion> => {
    // Se guarda una copia: el agente sigue agregando mensajes al mismo arreglo.
    requests.push({ ...request, messages: [...request.messages] });
    const step = steps[i++];
    if (!step) throw new Error("el guion se quedó sin pasos");
    if (step instanceof Error) throw step;
    const toolCalls: ToolCall[] | undefined = step.calls?.map((c, n) => ({
      id: `call_${i}_${n}`,
      name: c.name,
      arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args)
    }));
    return {
      content: step.content ?? "",
      finishReason: toolCalls ? "tool_calls" : "stop",
      ...(toolCalls ? { toolCalls } : {}),
      model: "fake-model",
      provider: "fake",
      usage: { inputTokens: 1, outputTokens: 1 }
    };
  });
  const deps: AgentDeps = {
    complete,
    buildMessages: async ({ message }) => [{ role: "system", content: "reglas" }, { role: "user", content: message }]
  };
  return { deps, requests, complete };
}

const load = vi.fn(async () => ({
  tasks: [],
  sessions: [],
  availability: DEFAULT_AVAILABILITY,
  overrides: {},
  inflation: 1
}));
const tools = (): ToolContext => ({ today: "2026-09-28", now: NOW, load });

const params = (message = "hola") => ({
  message,
  contextStatic: "reglas",
  context: "ctx",
  history: [],
  isPro: false,
  tools: tools()
});

describe("sin tools", () => {
  it("una charla se contesta en una ronda, sin efectos", async () => {
    const { deps, complete } = script([{ content: "¡Hola! ¿Cómo andás?" }]);
    const result = await runMiloAgent(params(), deps);
    expect(result).toMatchObject({ text: "¡Hola! ¿Cómo andás?", taskActions: [], proposal: null, toolsUsed: [], rounds: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("le ofrece las cinco tools al modelo, con tool_choice auto", async () => {
    const { deps, requests } = script([{ content: "hola" }]);
    await runMiloAgent(params(), deps);
    expect(requests[0].tools?.map((t) => t.name)).toEqual(["create_items", "plan_week", "get_schedule", "ask_user", "remember_fact"]);
    expect(requests[0].toolChoice).toBe("auto");
  });

  it("usa el tier pro para un usuario Pro", async () => {
    const { deps, requests } = script([{ content: "hola" }]);
    await runMiloAgent({ ...params(), isPro: true }, deps);
    expect(requests[0].tier).toBe("pro");
  });
});

describe("create_items", () => {
  const items = [
    { title: "Cursar", kind: "task", dueDate: "2026-09-29" },
    { title: "Gimnasio", kind: "task", dueDate: "2026-09-30", repeat: { freq: "weekly", weekdays: [3, 6] } }
  ];

  it("propone, devuelve el resultado al modelo y deja que escriba la respuesta", async () => {
    const { deps, requests } = script([
      { calls: [{ name: "create_items", args: { items } }] },
      { content: "Te propongo cursar mañana y el gimnasio los miércoles y sábados." }
    ]);
    const result = await runMiloAgent(params("mañana cursar y gym miércoles y sábados"), deps);

    expect(result.taskActions.map((t) => t.title)).toEqual(["Cursar", "Gimnasio"]);
    expect(result.taskActions[1].repeat?.freq).toBe("weekly");
    expect(result.proposal).toBeNull();
    expect(result.text).toMatch(/Te propongo/);
    expect(result.toolsUsed).toEqual(["create_items"]);
    expect(result.rounds).toBe(2);

    // La segunda ronda ve la llamada y su resultado, y solo puede escribir texto.
    const second = requests[1];
    expect(second.toolChoice).toBe("none");
    const assistant = second.messages.find((m) => m.role === "assistant");
    const toolMsg = second.messages.find((m) => m.role === "tool");
    expect(assistant && "toolCalls" in assistant ? assistant.toolCalls[0].name : null).toBe("create_items");
    expect(toolMsg && "toolCallId" in toolMsg ? toolMsg.toolCallId : null).toBe("call_1_0");
    expect(JSON.parse(toolMsg!.content).note).toMatch(/Todavía no se creó nada/);
  });

  it("sin texto después de proponer, muestra uno por defecto", async () => {
    const { deps } = script([{ calls: [{ name: "create_items", args: { items } }] }, { content: "   " }]);
    const result = await runMiloAgent(params(), deps);
    expect(result.text).toBe(DEFAULT_ITEMS_TEXT);
    expect(result.taskActions).toHaveLength(2);
  });

  it("si el modelo la llama con argumentos inválidos, ve el error y la corrige", async () => {
    const { deps, requests } = script([
      { calls: [{ name: "create_items", args: '{"items": [' }] },
      { calls: [{ name: "create_items", args: { items } }] },
      { content: "Listo, te lo propongo." }
    ]);
    const result = await runMiloAgent(params(), deps);
    expect(result.taskActions).toHaveLength(2);
    expect(result.toolsUsed).toEqual(["create_items"]); // la fallida no cuenta
    const firstResult = requests[1].messages.find((m) => m.role === "tool")!;
    expect(JSON.parse(firstResult.content).ok).toBe(false);
    expect(requests[1].toolChoice).toBe("auto"); // todavía puede reintentar
  });

  it("una propuesta nueva reemplaza a la anterior", async () => {
    const { deps } = script([
      { calls: [{ name: "create_items", args: { items } }] },
      { content: "ok" }
    ]);
    const first = await runMiloAgent(params(), deps);
    expect(first.taskActions).toHaveLength(2);

    const again = script([
      { calls: [{ name: "create_items", args: { items: [items[0]] } }] },
      { content: "Sin el gimnasio." }
    ]);
    const second = await runMiloAgent(params("sacá el gimnasio"), again.deps);
    expect(second.taskActions.map((t) => t.title)).toEqual(["Cursar"]);
  });
});

describe("plan_week", () => {
  const weekItems = [
    { title: "Informe", kind: "task", estimateMin: 90 },
    { title: "Turno médico", kind: "reminder", estimateMin: 30, dueDate: "2026-10-01", time: "09:30" }
  ];

  it("devuelve la propuesta y los ítems a crear con sus fechas", async () => {
    const { deps } = script([
      { calls: [{ name: "plan_week", args: { items: weekItems } }] },
      { content: "Puse el informe el martes y dejé el sábado liviano." }
    ]);
    const result = await runMiloAgent(params("organizame la semana"), deps);
    expect(result.proposal?.days).toHaveLength(7);
    expect(result.taskActions.map((t) => t.title)).toEqual(["Informe", "Turno médico"]);
    expect(result.toolsUsed).toEqual(["plan_week"]);
    expect(result.text).toMatch(/informe/i);
  });

  it("get_schedule y después plan_week: la lectura no cierra el turno", async () => {
    const { deps, requests } = script([
      { calls: [{ name: "get_schedule", args: { from: "2026-09-28", to: "2026-10-04" } }] },
      { calls: [{ name: "plan_week", args: { items: weekItems } }] },
      { content: "Listo la propuesta." }
    ]);
    const result = await runMiloAgent(params(), deps);
    expect(result.toolsUsed).toEqual(["get_schedule", "plan_week"]);
    expect(result.rounds).toBe(3);
    expect(requests[1].toolChoice).toBe("auto");
    expect(requests[2].toolChoice).toBe("none");
  });

  it("sin texto, el mensaje por defecto habla de propuesta", async () => {
    const { deps } = script([{ calls: [{ name: "plan_week", args: { items: weekItems } }] }, { content: "" }]);
    expect((await runMiloAgent(params(), deps)).text).toBe(DEFAULT_PROPOSAL_TEXT);
  });
});

describe("get_schedule", () => {
  it("responde una consulta sin proponer nada", async () => {
    const { deps } = script([
      { calls: [{ name: "get_schedule", args: { from: "2026-10-01", to: "2026-10-01" } }] },
      { content: "El jueves no tenés nada agendado." }
    ]);
    const result = await runMiloAgent(params("¿qué tengo el jueves?"), deps);
    expect(result.taskActions).toEqual([]);
    expect(result.proposal).toBeNull();
    expect(result.text).toMatch(/jueves/);
  });
});

describe("ask_user", () => {
  it("la pregunta es la respuesta y el turno termina ahí", async () => {
    const { deps, complete } = script([
      { calls: [{ name: "ask_user", args: { question: "¿Qué cosas querés organizar esta semana?" } }] }
    ]);
    const result = await runMiloAgent(params("organizame la semana"), deps);
    expect(result.text).toBe("¿Qué cosas querés organizar esta semana?");
    expect(result.taskActions).toEqual([]);
    expect(result.proposal).toBeNull();
    expect(result.rounds).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("límites del bucle", () => {
  it("la última ronda fuerza texto aunque el modelo siga llamando tools", async () => {
    const read = { name: "get_schedule", args: { from: "2026-09-28", to: "2026-09-28" } };
    const { deps, requests } = script([
      { calls: [read] },
      { calls: [read] },
      { calls: [read] },
      { content: "Esto es lo que tenés." }
    ]);
    const result = await runMiloAgent(params(), deps);
    expect(result.rounds).toBe(MAX_ROUNDS);
    expect(requests[MAX_ROUNDS - 1].toolChoice).toBe("none");
    expect(result.text).toBe("Esto es lo que tenés.");
  });

  it("si en la ronda final el modelo llama una tool igual, no se ejecuta y hay texto por defecto", async () => {
    const read = { name: "get_schedule", args: { from: "2026-09-28", to: "2026-09-28" } };
    const { deps } = script([{ calls: [read] }, { calls: [read] }, { calls: [read] }, { calls: [read] }]);
    const result = await runMiloAgent(params(), deps);
    expect(result.text).toBe(DEFAULT_EMPTY_TEXT);
    expect(result.toolsUsed).toHaveLength(MAX_ROUNDS - 1);
  });

  it("cada tool_call recibe un resultado, incluso las que sobran", async () => {
    const many = Array.from({ length: MAX_CALLS_PER_ROUND + 2 }, () => ({
      name: "get_schedule",
      args: { from: "2026-09-28", to: "2026-09-28" }
    }));
    const { deps, requests } = script([{ calls: many }, { content: "ok" }]);
    await runMiloAgent(params(), deps);
    const messages = requests[1].messages;
    const asked = messages.find((m) => m.role === "assistant" && "toolCalls" in m);
    const ids = asked && "toolCalls" in asked ? asked.toolCalls.map((c) => c.id) : [];
    const answered = messages.filter((m) => m.role === "tool").map((m) => ("toolCallId" in m ? m.toolCallId : ""));
    expect(answered.sort()).toEqual([...ids].sort());
  });
});

describe("fallos", () => {
  const items = [{ title: "Cursar", kind: "task", dueDate: "2026-09-29" }];

  it("un fallo en la primera ronda se propaga (la ruta decide si cae al camino de texto)", async () => {
    const error = new ProviderError("400", { provider: "chain", kind: "bad_request", kinds: ["bad_request"] });
    const { deps } = script([error]);
    await expect(runMiloAgent(params(), deps)).rejects.toBe(error);
    expect(toolsNotSupported(error)).toBe(true);
  });

  it("un fallo después de proponer devuelve la propuesta con texto por defecto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = script([
      { calls: [{ name: "create_items", args: { items } }] },
      new ProviderError("caído", { provider: "chain", kind: "server", kinds: ["server"] })
    ]);
    const result = await runMiloAgent(params(), deps);
    expect(result.taskActions).toHaveLength(1);
    expect(result.text).toBe(DEFAULT_ITEMS_TEXT);
    warn.mockRestore();
  });

  it("un fallo después de solo leer la agenda sí se propaga", async () => {
    const { deps } = script([
      { calls: [{ name: "get_schedule", args: { from: "2026-09-28", to: "2026-09-28" } }] },
      new ProviderError("caído", { provider: "chain", kind: "server", kinds: ["server"] })
    ]);
    await expect(runMiloAgent(params(), deps)).rejects.toBeInstanceOf(ProviderError);
  });

  it("una respuesta vacía sin nada propuesto se reintenta una vez", async () => {
    const { deps, complete } = script([{ content: "" }, { content: "Ahí sí." }]);
    const result = await runMiloAgent(params(), deps);
    expect(result.text).toBe("Ahí sí.");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("si el reintento también falla, no rompe: texto por defecto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = script([{ content: "" }, new Error("boom")]);
    expect((await runMiloAgent(params(), deps)).text).toBe(DEFAULT_EMPTY_TEXT);
    warn.mockRestore();
  });

  it("toolsNotSupported solo reconoce 'todos rechazaron la request'", () => {
    expect(toolsNotSupported(new Error("x"))).toBe(false);
    expect(toolsNotSupported(new ProviderError("x", { provider: "a", kind: "rate_limited", kinds: ["rate_limited"] }))).toBe(false);
    expect(toolsNotSupported(new ProviderError("x", { provider: "a", kind: "unknown", kinds: ["bad_request", "server"] }))).toBe(false);
    expect(toolsNotSupported(new ProviderError("x", { provider: "a", kind: "bad_request" }))).toBe(true);
  });
});

describe("texto", () => {
  it("un resto de bloque TASKS_ACTION no llega al usuario", async () => {
    const { deps } = script([{ content: 'Dale.\nTASKS_ACTION:[{"title":"X","dueDate":"2026-09-29"}]' }]);
    const result = await runMiloAgent(params(), deps);
    expect(result.text).toBe("Dale.");
    expect(result.taskActions).toEqual([]);
  });
});
