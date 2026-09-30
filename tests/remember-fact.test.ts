import { describe, expect, it, vi } from "vitest";
import { executeTool, MAX_FACT_CALLS_PER_TURN, type FactsPort, type ToolContext } from "@/lib/milo-tools";
import type { UserFact } from "@/lib/user-facts";

const NOW = new Date("2026-09-28T12:00:00.000Z");

const fact = (key: string, value: string, source: UserFact["source"] = "stated"): UserFact => ({
  id: key,
  key,
  value,
  source,
  confidence: 1,
  updatedAt: "2026-09-01T00:00:00.000Z"
});

function setup(message: string, existing: UserFact[] = [], status: "saved" | "exists_stated" | "limit" = "saved") {
  const save = vi.fn(async () => ({ status }));
  const list = vi.fn(async () => existing);
  const facts: FactsPort = { list, save };
  const ctx: ToolContext = {
    today: "2026-09-28",
    now: NOW,
    load: vi.fn(),
    userMessage: message,
    turn: { factCalls: 0 },
    facts
  };
  return { ctx, save, list };
}

const call = (args: unknown) => ({ id: "c1", name: "remember_fact", arguments: JSON.stringify(args) });
const body = (content: string) => JSON.parse(content) as Record<string, any>;

describe("remember_fact: stated", () => {
  const message = "Ando re despistado, siempre me olvido las cosas. Mañana voy al gimnasio.";

  it("guarda lo que el usuario dijo, con sus palabras, y lo confirma", async () => {
    const { ctx, save } = setup(message);
    const out = await executeTool(call({ key: "Es Despistado", value: "sí, se olvida las cosas", source: "stated", quote: "re despistado" }), ctx);
    expect(out.isError).toBeUndefined();
    expect(save).toHaveBeenCalledWith({ key: "es_despistado", value: "sí, se olvida las cosas", source: "stated", confidence: 1 });
    expect(out.effect?.factSaved).toEqual({ key: "es_despistado", value: "sí, se olvida las cosas" });
    expect(body(out.content).saved).toBe(true);
  });

  it("NO guarda si las palabras no están en el mensaje del usuario (lo supuso el modelo)", async () => {
    const { ctx, save } = setup(message);
    const out = await executeTool(call({ key: "es_despistado", value: "sí", source: "stated", quote: "es muy distraído" }), ctx);
    expect(out.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(out.effect).toBeUndefined();
    expect(body(out.content).error).toContain("inferred");
  });

  it("sin quote tampoco", async () => {
    const { ctx, save } = setup(message);
    expect((await executeTool(call({ key: "es_despistado", value: "sí", source: "stated" }), ctx)).isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("no acepta una cita que viene de la memoria y no del mensaje de ahora", async () => {
    const { ctx, save } = setup("hola, ¿qué tengo hoy?");
    const out = await executeTool(call({ key: "deportes", value: "pádel", source: "stated", quote: "juego al pádel los martes" }), ctx);
    expect(out.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("un límite lleno se le explica al modelo", async () => {
    const { ctx } = setup(message, [], "limit");
    const out = await executeTool(call({ key: "deportes", value: "pádel", source: "stated", quote: "gimnasio" }), ctx);
    expect(out.isError).toBe(true);
    expect(body(out.content).error).toContain("Lo que Spark sabe de vos");
  });
});

describe("remember_fact: datos sensibles", () => {
  const cases: Array<[string, string, string]> = [
    ["tengo diabetes", "salud", "tengo diabetes"],
    ["voy a terapia los jueves", "actividad", "voy a terapia"],
    ["gano 800 mil de sueldo", "ingresos", "gano 800 mil de sueldo"],
    ["mi mail es ana@correo.com", "contacto", "ana@correo.com"],
    ["soy católico practicante", "creencia", "soy católico"]
  ];

  it.each(cases)("%s → no se guarda, ni dicho ni deducido", async (message, key, quote) => {
    for (const source of ["stated", "inferred"] as const) {
      const { ctx, save } = setup(message);
      const out = await executeTool(call({ key, value: message, source, quote }), ctx);
      expect(out.isError, `${source}`).toBe(true);
      expect(out.effect, `${source}`).toBeUndefined();
      expect(save).not.toHaveBeenCalled();
      expect(body(out.content).error).toMatch(/no se guarda/i);
    }
  });

  it("aunque el sensible venga en la clave y el valor sea inocente", async () => {
    const { ctx, save } = setup("hago terapia");
    const out = await executeTool(call({ key: "salud_mental", value: "en tratamiento", source: "stated", quote: "hago terapia" }), ctx);
    expect(out.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("remember_fact: inferred", () => {
  it("nunca se guarda: vuelve como propuesta para que el usuario confirme", async () => {
    const { ctx, save } = setup("mañana tengo parcial de cálculo");
    const out = await executeTool(call({ key: "estudia", value: "algo de matemática", source: "inferred", confidence: 0.55 }), ctx);
    expect(out.isError).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(out.effect?.factProposal).toEqual({ key: "estudia", value: "algo de matemática", confidence: 0.55 });
    expect(out.effect?.factSaved).toBeUndefined();
    expect(body(out.content)).toMatchObject({ saved: false });
    expect(body(out.content).note).toMatch(/NO está guardado/);
  });

  it("no exige quote", async () => {
    const { ctx } = setup("hola");
    expect((await executeTool(call({ key: "estudia", value: "derecho", source: "inferred" }), ctx)).effect?.factProposal).toBeDefined();
  });

  it("acota la confianza y usa un default razonable", async () => {
    const { ctx } = setup("hola");
    expect((await executeTool(call({ key: "a1", value: "x", source: "inferred", confidence: 7 }), ctx)).effect?.factProposal?.confidence).toBe(0.95);
    expect((await executeTool(call({ key: "a2", value: "x", source: "inferred", confidence: -1 }), ctx)).effect?.factProposal?.confidence).toBe(0.1);
    expect((await executeTool(call({ key: "a3", value: "x", source: "inferred" }), ctx)).effect?.factProposal?.confidence).toBe(0.6);
  });

  it("no propone lo que ya sabemos: ni lo dicho ni lo mismo", async () => {
    const { ctx } = setup("hola", [fact("estudia", "derecho", "stated"), fact("deporte", "yoga", "inferred")]);
    const stated = await executeTool(call({ key: "estudia", value: "ingeniería", source: "inferred" }), ctx);
    expect(stated.effect).toBeUndefined();
    const same = await executeTool(call({ key: "deporte", value: "yoga", source: "inferred" }), ctx);
    expect(same.effect).toBeUndefined();
    const update = await executeTool(call({ key: "deporte", value: "pilates", source: "inferred" }), ctx);
    expect(update.effect?.factProposal).toBeDefined();
  });
});

describe("remember_fact: validación y topes", () => {
  it("valida source, clave y valor", async () => {
    const { ctx, save } = setup("hola");
    for (const args of [
      { key: "ok_clave", value: "x", source: "otro" },
      { key: "!!", value: "x", source: "inferred" },
      { key: "ok_clave", value: "", source: "inferred" },
      { key: "ok_clave", value: "x".repeat(300), source: "inferred" },
      {}
    ]) {
      expect((await executeTool(call(args), ctx)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("como mucho tres por mensaje", async () => {
    const { ctx } = setup("uno dos tres cuatro");
    const results = [];
    for (let n = 0; n < MAX_FACT_CALLS_PER_TURN + 2; n += 1) {
      results.push(await executeTool(call({ key: `dato_${n}`, value: "x", source: "inferred" }), ctx));
    }
    expect(results.filter((r) => !r.isError)).toHaveLength(MAX_FACT_CALLS_PER_TURN);
    expect(body(results.at(-1)!.content).error).toMatch(/por mensaje/);
  });

  it("sin acceso a la memoria, la tool falla en silencio para el usuario", async () => {
    const ctx: ToolContext = { today: "2026-09-28", now: NOW, load: vi.fn(), userMessage: "hola" };
    const out = await executeTool(call({ key: "ok_clave", value: "x", source: "inferred" }), ctx);
    expect(out.isError).toBe(true);
  });

  it("no lee la agenda: guardar un hecho no cuesta consultas de más", async () => {
    const { ctx } = setup("soy despistado");
    await executeTool(call({ key: "es_despistado", value: "sí", source: "stated", quote: "despistado" }), ctx);
    expect(ctx.load).not.toHaveBeenCalled();
  });
});
