import { describe, expect, it, vi } from "vitest";
import { buildContextSummary, chunkText, SINGLE_PASS_MAX, TOTAL_BUDGET, type Summarize } from "@/lib/context-summary";

const fakeSummarize = () => vi.fn<Summarize>(async (text, max) => `RESUMEN(${text.length})`.slice(0, max));

describe("chunkText", () => {
  it("un texto corto es un solo trozo", () => {
    expect(chunkText("hola")).toEqual(["hola"]);
    expect(chunkText("")).toEqual([]);
  });

  it("parte en trozos que no pasan el tamaño, sin perder texto", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Párrafo ${i} con bastante contenido para que ocupe lugar.`).join("\n\n");
    const chunks = chunkText(text, 2000);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("Párrafo 299");
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("Párrafo 0 ");
  });

  it("prefiere cortar en un límite de párrafo", () => {
    const text = `${"a".repeat(1500)}\n\n${"b".repeat(1500)}`;
    const [first] = chunkText(text, 2000);
    expect(first).toBe("a".repeat(1500));
  });

  it("no genera trozos de más con un texto enorme", () => {
    expect(chunkText("x".repeat(1_000_000)).length).toBeLessThanOrEqual(20);
  });
});

describe("buildContextSummary", () => {
  it("sin archivos o con archivos vacíos devuelve vacío y no llama a la IA", async () => {
    const summarize = fakeSummarize();
    expect(await buildContextSummary([], summarize)).toBe("");
    expect(await buildContextSummary([{ name: "a.txt", text: "  \n " }], summarize)).toBe("");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("un texto que ya entra en su parte se guarda tal cual, sin IA", async () => {
    const summarize = fakeSummarize();
    const out = await buildContextSummary([{ name: "consigna.txt", text: "Entregar el 15/10.\nIndividual." }], summarize);
    expect(out).toBe("## consigna.txt\nEntregar el 15/10.\nIndividual.");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("un texto mediano se resume en una sola pasada", async () => {
    const summarize = fakeSummarize();
    const out = await buildContextSummary([{ name: "a.txt", text: "x".repeat(8000) }], summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0][0]).toHaveLength(8000);
    expect(out).toContain("RESUMEN(8000)");
  });

  it("un texto largo se resume por partes y después se resumen los resúmenes", async () => {
    const summarize = vi.fn<Summarize>(async (_text, max) => "y".repeat(max));
    const text = Array.from({ length: 3000 }, (_, i) => `Oración número ${i} del documento largo.`).join("\n");
    expect(text.length).toBeGreaterThan(SINGLE_PASS_MAX * 5);
    const out = await buildContextSummary([{ name: "largo.txt", text }], summarize);
    const calls = summarize.mock.calls;
    // Ninguna llamada recibe más de lo que entra en una pasada: nunca se manda todo de una vez.
    for (const [input] of calls) expect(input.length).toBeLessThanOrEqual(SINGLE_PASS_MAX);
    expect(calls.length).toBeGreaterThan(3);
    expect(out.length).toBeLessThanOrEqual(TOTAL_BUDGET);
    expect(calls.some(([, , hint]) => hint.includes("summaries of the parts"))).toBe(true);
  });

  it("reparte el presupuesto entre archivos y nunca pasa el total", async () => {
    const summarize = vi.fn<Summarize>(async (_t, max) => "z".repeat(max * 2)); // se pasa a propósito
    const files = ["a", "b", "c"].map((n) => ({ name: `${n}.txt`, text: `${n} `.repeat(6000) }));
    const out = await buildContextSummary(files, summarize);
    expect(out.length).toBeLessThanOrEqual(TOTAL_BUDGET);
    for (const n of ["a", "b", "c"]) expect(out).toContain(`## ${n}.txt`);
  });

  it("conserva el nombre de cada archivo como encabezado", async () => {
    const out = await buildContextSummary(
      [{ name: "uno.md", text: "Texto uno" }, { name: "dos.pdf", text: "Texto dos" }],
      fakeSummarize()
    );
    expect(out).toBe("## uno.md\nTexto uno\n\n## dos.pdf\nTexto dos");
  });
});
