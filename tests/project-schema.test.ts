import { describe, expect, it } from "vitest";
import { extractJsonObject, parseIntake, parsePlan } from "@/lib/project-schema";

const sub = (tempId: string, over: Record<string, unknown> = {}) => ({
  tempId, title: `Hacer ${tempId}`, estimateMin: 30, dependsOn: [], ...over
});
const plan = (subtasks: unknown[]) => JSON.stringify({ subtasks });
const four = () => [sub("a"), sub("b", { dependsOn: ["a"] }), sub("c", { dependsOn: ["b"] }), sub("d", { dependsOn: ["c"] })];
const okPlan = (raw: string) => {
  const r = parsePlan(raw);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const planError = (raw: string) => {
  const r = parsePlan(raw);
  return r.ok ? null : r.error;
};

describe("extractJsonObject", () => {
  it("lee JSON puro, con cercas de código y con texto alrededor", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Acá va el plan:\n{"a":{"b":[1,2]}}\nEspero que sirva.')).toEqual({ a: { b: [1, 2] } });
  });

  it("no se confunde con llaves dentro de strings", () => {
    expect(extractJsonObject('{"t":"usa {llaves} y \\"comillas\\""}')).toEqual({ t: 'usa {llaves} y "comillas"' });
  });

  it("devuelve null cuando no hay un objeto o está cortado", () => {
    expect(extractJsonObject("no hay json")).toBeNull();
    expect(extractJsonObject('{"a":')).toBeNull();
    expect(extractJsonObject("[1,2,3]")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });
});

describe("parseIntake", () => {
  const base = { understanding: "Es un TP de álgebra para el 15/10, individual, con una consigna de 5 ejercicios." };

  it("acepta un intake con preguntas de los tres tipos", () => {
    const r = parseIntake(JSON.stringify({
      ...base,
      questions: [
        { id: "q1", text: "¿Ya avanzaste algo?", why: "Cambia cuánto falta", type: "text" },
        { id: "q2", text: "¿Es grupal o individual?", why: "Reparte el trabajo", type: "choice", options: ["Individual", "Grupal"] },
        { id: "q3", text: "¿Cuántas horas por día?", why: "Ajusta el ritmo", type: "number" }
      ]
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.questions.map((q) => q.type)).toEqual(["text", "choice", "number"]);
      expect(r.value.questions[1].options).toEqual(["Individual", "Grupal"]);
    }
  });

  it("questions = [] es válido: no hace falta preguntar nada", () => {
    const r = parseIntake(JSON.stringify({ ...base, questions: [] }));
    expect(r).toMatchObject({ ok: true, value: { questions: [] } });
  });

  it("recorta a 5 preguntas y lo avisa", () => {
    const questions = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, text: `Pregunta ${i}`, why: "x", type: "text" }));
    const r = parseIntake(JSON.stringify({ ...base, questions }));
    expect(r.ok && r.value.questions).toHaveLength(5);
    expect(r.ok && r.warnings.join(" ")).toMatch(/kept the first 5/);
  });

  it("repara ids faltantes o repetidos en vez de fallar", () => {
    const r = parseIntake(JSON.stringify({
      ...base,
      questions: [{ text: "Uno", type: "text" }, { id: "x", text: "Dos", type: "text" }, { id: "x", text: "Tres", type: "text" }]
    }));
    expect(r.ok && r.value.questions.map((q) => q.id)).toEqual(["q1", "x", "q3"]);
  });

  it("un choice sin opciones usables pasa a texto", () => {
    const r = parseIntake(JSON.stringify({ ...base, questions: [{ id: "a", text: "¿Cuál?", type: "choice", options: ["única"] }] }));
    expect(r.ok && r.value.questions[0]).toMatchObject({ type: "text" });
    expect(r.ok && r.value.questions[0]).not.toHaveProperty("options");
  });

  it("un tipo desconocido se toma como texto y las opciones se limpian", () => {
    const r = parseIntake(JSON.stringify({ ...base, questions: [
      { id: "a", text: "¿Algo?", type: "voz" },
      { id: "b", text: "¿Cuál?", type: "choice", options: ["A", "A", " B ", "", 5] }
    ] }));
    expect(r.ok && r.value.questions[0].type).toBe("text");
    expect(r.ok && r.value.questions[1].options).toEqual(["A", "B"]);
  });

  it("rechaza lo que no se puede arreglar, con un mensaje que dice qué falta", () => {
    const err = (raw: string) => { const r = parseIntake(raw); return r.ok ? null : r.error; };
    expect(err("hola")).toMatch(/not a valid JSON/);
    expect(err(JSON.stringify({ questions: [] }))).toMatch(/understanding/);
    expect(err(JSON.stringify({ understanding: "corto" , questions: [] }))).toMatch(/understanding/);
    expect(err(JSON.stringify({ ...base }))).toMatch(/questions/);
    expect(err(JSON.stringify({ ...base, questions: [{ id: "a", type: "text" }] }))).toMatch(/questions\[0\]\.text/);
    expect(err(JSON.stringify({ ...base, questions: ["¿hola?"] }))).toMatch(/questions\[0\] must be an object/);
  });
});

describe("parsePlan: forma y rangos", () => {
  it("acepta un plan válido y normaliza", () => {
    const r = okPlan(plan([sub("a", { title: "  Armar la tabla  ", deliverable: true }), ...four().slice(1), sub("e")]));
    expect(r.value).toHaveLength(5);
    expect(r.value[0]).toMatchObject({ tempId: "a", title: "Armar la tabla", deliverable: true, dependsOn: [] });
    expect(r.value[1].deliverable).toBe(false);
  });

  it("acepta el JSON con cercas y texto alrededor", () => {
    expect(parsePlan("Listo:\n```json\n" + plan(four()) + "\n```").ok).toBe(true);
  });

  it("exige entre 4 y 25 subtareas", () => {
    expect(planError(plan(four().slice(0, 3)))).toMatch(/between 4 and 25.*got 3/);
    expect(planError(plan(Array.from({ length: 26 }, (_, i) => sub(`t${i}`))))).toMatch(/got 26/);
    expect(parsePlan(plan(Array.from({ length: 25 }, (_, i) => sub(`t${i}`)))).ok).toBe(true);
    expect(parsePlan(plan(Array.from({ length: 4 }, (_, i) => sub(`t${i}`)))).ok).toBe(true);
  });

  it("las estimaciones van de 10 a 240 minutos, enteras", () => {
    const withEstimate = (n: unknown) => plan([...four().slice(0, 3), sub("d", { estimateMin: n })]);
    expect(parsePlan(withEstimate(10)).ok).toBe(true);
    expect(parsePlan(withEstimate(240)).ok).toBe(true);
    expect(planError(withEstimate(9))).toMatch(/d: estimateMin 9 is out of range/);
    expect(planError(withEstimate(241))).toMatch(/out of range/);
    expect(planError(withEstimate(30.5))).toMatch(/integer/);
    expect(planError(withEstimate("30"))).toMatch(/integer/);
    expect(planError(withEstimate(null))).toMatch(/integer/);
  });

  it("valida los títulos", () => {
    const t = (title: unknown) => plan([...four().slice(0, 3), sub("d", { title })]);
    expect(planError(t(""))).toMatch(/title/);
    expect(planError(t("ab"))).toMatch(/title/);
    expect(planError(t("x".repeat(121)))).toMatch(/title/);
    expect(planError(t(42))).toMatch(/title/);
  });

  it("ids: obligatorios y únicos", () => {
    expect(planError(plan([sub("a"), sub("a"), sub("c"), sub("d")]))).toMatch(/duplicate tempId/);
    expect(planError(plan([sub(""), sub("b"), sub("c"), sub("d")]))).toMatch(/tempId/);
  });

  it("subtasks tiene que ser un array y la respuesta un objeto JSON", () => {
    expect(planError('{"subtasks":"nada"}')).toMatch(/must be an array/);
    expect(planError("lo siento, no puedo")).toMatch(/not a valid JSON/);
    expect(planError('{"subtasks":[')).toMatch(/not a valid JSON/);
  });

  it("informa todos los problemas juntos, para que el reintento los arregle de una vez", () => {
    const err = planError(plan([sub("a", { estimateMin: 5 }), sub("b", { title: "" }), sub("c", { dependsOn: ["zzz"] }), sub("d")]));
    expect(err).toMatch(/a: estimateMin 5/);
    expect(err).toMatch(/b: title/);
    expect(err).toMatch(/unknown tempId "zzz"/);
  });
});

describe("parsePlan: dependencias", () => {
  it("una dependencia inexistente o a sí misma es un error", () => {
    expect(planError(plan([sub("a", { dependsOn: ["a"] }), sub("b"), sub("c"), sub("d")]))).toMatch(/depends on itself/);
    expect(planError(plan([sub("a", { dependsOn: ["x"] }), sub("b"), sub("c"), sub("d")]))).toMatch(/unknown tempId "x"/);
  });

  it("un ciclo directo o largo es un error con el camino", () => {
    const direct = planError(plan([sub("a", { dependsOn: ["b"] }), sub("b", { dependsOn: ["a"] }), sub("c"), sub("d")]));
    expect(direct).toMatch(/Circular dependency: .*a.*b/);
    const long = planError(plan([sub("a", { dependsOn: ["d"] }), sub("b", { dependsOn: ["a"] }), sub("c", { dependsOn: ["b"] }), sub("d", { dependsOn: ["c"] })]));
    expect(long).toMatch(/Circular dependency/);
  });

  it("acepta diamantes y dependencias múltiples (es un DAG)", () => {
    const r = parsePlan(plan([
      sub("a"), sub("b", { dependsOn: ["a"] }), sub("c", { dependsOn: ["a"] }), sub("d", { dependsOn: ["b", "c"] })
    ]));
    expect(r.ok).toBe(true);
  });

  it("deduplica dependencias repetidas y tolera dependsOn ausente", () => {
    const raw = JSON.stringify({ subtasks: [
      { tempId: "a", title: "Uno", estimateMin: 30 },
      { tempId: "b", title: "Dos", estimateMin: 30, dependsOn: ["a", "a"] },
      sub("c"), sub("d")
    ] });
    const r = okPlan(raw);
    expect(r.value[0].dependsOn).toEqual([]);
    expect(r.value[1].dependsOn).toEqual(["a"]);
  });
});

describe("parsePlan: avisos", () => {
  it("avisa si ninguna subtarea se puede arrancar hoy en 30 min o menos", () => {
    const r = okPlan(plan([sub("a", { estimateMin: 90 }), sub("b", { dependsOn: ["a"] }), sub("c"), sub("d")].map((s, i) => (i === 2 ? { ...s, dependsOn: ["a"] } : i === 3 ? { ...s, dependsOn: ["b"] } : s))));
    expect(r.warnings.join(" ")).toMatch(/started today/);
  });

  it("no avisa cuando hay una primera subtarea corta y sin dependencias", () => {
    expect(okPlan(plan(four())).warnings).toEqual([]);
  });
});
