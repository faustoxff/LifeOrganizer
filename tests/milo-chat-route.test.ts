import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La ruta de chat con tools: qué camino toma según el plan y el proveedor, qué le manda
 * al modelo y qué le devuelve al cliente. El modelo y la base están reemplazados.
 */
const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getUserPlan: vi.fn(),
  consumeDailyUsage: vi.fn(),
  chainSupportsTools: vi.fn(),
  runMiloAgent: vi.fn(),
  chatWithMilo: vi.fn(),
  getUserMemory: vi.fn(),
  bumpMessageCount: vi.fn(),
  createToolContext: vi.fn()
}));

vi.mock("@/lib/db", () => ({ default: vi.fn() }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn()
}));
vi.mock("@/lib/server-auth", () => ({ requireAuth: mocks.requireAuth, getUserPlan: mocks.getUserPlan }));
vi.mock("@/lib/usage-limits", async (original) => ({
  ...(await original<typeof import("@/lib/usage-limits")>()),
  consumeDailyUsage: mocks.consumeDailyUsage
}));
vi.mock("@/lib/ai/registry", async (original) => ({
  ...(await original<typeof import("@/lib/ai/registry")>()),
  chainSupportsTools: mocks.chainSupportsTools
}));
vi.mock("@/lib/milo-agent", async (original) => ({
  ...(await original<typeof import("@/lib/milo-agent")>()),
  runMiloAgent: mocks.runMiloAgent
}));
vi.mock("@/lib/milo", async (original) => ({
  ...(await original<typeof import("@/lib/milo")>()),
  chatWithMilo: mocks.chatWithMilo,
  refreshUserMemorySummary: vi.fn(async () => "memoria")
}));
vi.mock("@/lib/milo-tools-server", () => ({ createToolContext: mocks.createToolContext }));
vi.mock("@/lib/user-memory", () => ({
  getUserMemory: mocks.getUserMemory,
  saveUserMemory: vi.fn(),
  bumpMessageCount: mocks.bumpMessageCount,
  shouldRefreshMemory: () => false
}));
vi.mock("@/lib/user-settings", () => ({ resolveUserTimeZone: async () => "UTC" }));

import { POST } from "@/app/api/milo/chat/route";
import { ProviderError } from "@/lib/ai/types";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/milo/chat", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

const agentResult = (over: Record<string, unknown> = {}) => ({
  text: "Te propongo esto.",
  taskActions: [],
  proposal: null,
  toolsUsed: [],
  rounds: 1,
  provider: "groq",
  model: "m",
  ...over
});

const item = { title: "Informe", kind: "task", dueDate: "2026-09-29", estimateMin: 90, priority: "medium", category: "general", description: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue("user_A");
  mocks.getUserPlan.mockResolvedValue("plus");
  mocks.consumeDailyUsage.mockResolvedValue({ allowed: true, limit: 60 });
  mocks.chainSupportsTools.mockReturnValue(true);
  mocks.getUserMemory.mockResolvedValue("");
  mocks.bumpMessageCount.mockResolvedValue({ count: 1 });
  mocks.runMiloAgent.mockResolvedValue(agentResult());
  mocks.chatWithMilo.mockResolvedValue({ content: "hola", model: "m", provider: "groq" });
  mocks.createToolContext.mockReturnValue({ today: "2026-09-28", now: new Date(), load: vi.fn() });
});

describe("auth y límites (igual que antes)", () => {
  it("sin sesión: 401 y nada más", async () => {
    mocks.requireAuth.mockRejectedValue(new Error("no"));
    expect((await post({ message: "hola" })).status).toBe(401);
    expect(mocks.runMiloAgent).not.toHaveBeenCalled();
  });

  it("cuenta UN uso de milo_chat por mensaje, tantas rondas como haga el agente", async () => {
    mocks.runMiloAgent.mockResolvedValue(agentResult({ rounds: 4 }));
    await post({ message: "organizame la semana" });
    expect(mocks.consumeDailyUsage).toHaveBeenCalledTimes(1);
    expect(mocks.consumeDailyUsage).toHaveBeenCalledWith("user_A", "milo_chat", "plus");
  });

  it("pasado el límite: 429 sin llamar al modelo", async () => {
    mocks.consumeDailyUsage.mockResolvedValue({ allowed: false, limit: 60 });
    const res = await post({ message: "hola" });
    expect(res.status).toBe(429);
    expect(mocks.runMiloAgent).not.toHaveBeenCalled();
    expect(mocks.chatWithMilo).not.toHaveBeenCalled();
  });

  it("valida el mensaje", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ message: "x".repeat(4001) })).status).toBe(400);
  });
});

describe("camino de tools", () => {
  it("un usuario Plus con proveedor que soporta tools usa el agente, atado a su id", async () => {
    mocks.runMiloAgent.mockResolvedValue(agentResult({ taskActions: [item], toolsUsed: ["create_items"] }));
    const res = await post({ message: "el viernes entrego el informe", tasks: [] });
    const body = await res.json();

    expect(mocks.chatWithMilo).not.toHaveBeenCalled();
    expect(mocks.createToolContext).toHaveBeenCalledWith("user_A", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.any(Date));
    expect(body.response).toBe("Te propongo esto.");
    expect(body.taskActions).toHaveLength(1);
    expect(body.proposal).toBeNull();
  });

  it("el prompt del agente no conoce TASKS_ACTION", async () => {
    await post({ message: "hola" });
    const args = mocks.runMiloAgent.mock.calls[0][0];
    expect(args.contextStatic).not.toContain("TASKS_ACTION");
    expect(args.contextStatic).toContain("create_items");
  });

  it("devuelve la propuesta semanal al cliente", async () => {
    const proposal = { weekStart: "2026-09-28", days: [], outside: [], deferred: [], warnings: [] };
    mocks.runMiloAgent.mockResolvedValue(agentResult({ taskActions: [item], proposal }));
    const body = await (await post({ message: "organizame la semana" })).json();
    expect(body.proposal).toEqual(proposal);
    expect(body.taskActions).toHaveLength(1);
  });

  it("una pregunta de ask_user vuelve como texto, sin ítems", async () => {
    mocks.runMiloAgent.mockResolvedValue(agentResult({ text: "¿Qué querés organizar?" }));
    const body = await (await post({ message: "organizame la semana" })).json();
    expect(body).toEqual({ response: "¿Qué querés organizar?", taskActions: null, proposal: null });
  });

  it("los ítems pendientes que manda el cliente van al prompt, normalizados", async () => {
    await post({
      message: "pasalo al miércoles",
      pendingTaskActions: [item, { title: "" }, "basura", { title: "Gym", dueDate: "no-fecha" }]
    });
    const { context } = mocks.runMiloAgent.mock.calls[0][0];
    expect(context).toContain("Propuesta pendiente de confirmación");
    expect(context).toContain("- Informe — 2026-09-29, 90 min, task");
    expect(context).toContain("- Gym");
    expect(context).not.toContain("basura");
  });

  it("acepta el formato viejo de un solo ítem pendiente", async () => {
    await post({ message: "ok", pendingTaskAction: item });
    expect(mocks.runMiloAgent.mock.calls[0][0].context).toContain("- Informe — 2026-09-29");
  });

  it("un error del proveedor que no es 'sin tools' se devuelve como antes (503 si está ocupado)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runMiloAgent.mockRejectedValue(new ProviderError("429", { provider: "chain", kind: "rate_limited", kinds: ["rate_limited"] }));
    const res = await post({ message: "hola" });
    expect(res.status).toBe(503);
    expect(mocks.chatWithMilo).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("fallback al bloque TASKS_ACTION", () => {
  it("si ningún proveedor soporta tools, va directo al camino de texto y lo parsea", async () => {
    mocks.chainSupportsTools.mockReturnValue(false);
    mocks.chatWithMilo.mockResolvedValue({
      content: 'Dale, te lo propongo.\nTASKS_ACTION:[{"title":"Informe","dueDate":"2026-09-29"}]',
      model: "m",
      provider: "ollama"
    });
    const body = await (await post({ message: "el viernes entrego el informe" })).json();

    expect(mocks.runMiloAgent).not.toHaveBeenCalled();
    expect(body.response).toBe("Dale, te lo propongo.");
    expect(body.taskActions).toHaveLength(1);
    expect(body.proposal).toBeNull();
    // Solo este camino le habla a Milo del formato.
    expect(mocks.chatWithMilo.mock.calls[0][0].contextStatic).toContain("TASKS_ACTION");
  });

  it("si todos los proveedores rechazan la request con tools, cae al texto en el mismo turno", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.runMiloAgent.mockRejectedValue(new ProviderError("400", { provider: "chain", kind: "bad_request", kinds: ["bad_request", "bad_request"] }));
    mocks.chatWithMilo.mockResolvedValue({ content: 'Va.\nTASKS_ACTION:[{"title":"Gym","dueDate":"2026-09-30"}]', model: "m", provider: "groq" });
    const res = await post({ message: "agendame gym el miércoles" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.chatWithMilo).toHaveBeenCalledTimes(1);
    expect(body.taskActions).toHaveLength(1);
    expect(mocks.consumeDailyUsage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("plan Free", () => {
  beforeEach(() => mocks.getUserPlan.mockResolvedValue("free"));

  it("no recibe tools ni bloque: chat de texto con la explicación del upgrade", async () => {
    mocks.chatWithMilo.mockResolvedValue({ content: "Para crear tareas por chat necesitás Plus (/plans).", model: "m", provider: "groq" });
    const body = await (await post({ message: "agendame ir al gym mañana" })).json();

    expect(mocks.runMiloAgent).not.toHaveBeenCalled();
    expect(mocks.chainSupportsTools).not.toHaveBeenCalled();
    const { contextStatic } = mocks.chatWithMilo.mock.calls[0][0];
    expect(contextStatic).toContain("plan Free");
    expect(contextStatic).not.toContain("create_items");
    expect(contextStatic).not.toContain("TASKS_ACTION:[{");
    expect(body.taskActions).toBeNull();
    expect(body.proposal).toBeNull();
  });

  it("aunque el modelo escribiera un bloque, Free no recibe ítems", async () => {
    mocks.chatWithMilo.mockResolvedValue({ content: 'Ok.\nTASKS_ACTION:[{"title":"X","dueDate":"2026-09-30"}]', model: "m", provider: "groq" });
    const body = await (await post({ message: "agendame algo" })).json();
    expect(body.taskActions).toBeNull();
  });
});
