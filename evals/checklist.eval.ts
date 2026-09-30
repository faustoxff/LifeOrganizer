import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { complete } from "@/lib/ai/complete";
import { classifyTitles, generateInitialList, type ChecklistAiDeps } from "@/lib/checklist-ai";
import { ITEM_MAX_LENGTH, selectItems } from "@/lib/checklist";
import { sensitiveCategory } from "@/lib/sensitive";
import { normalizeTitle } from "@/lib/activity";
import { CLASSIFY_CASES, GENERATE_CASES } from "./checklist-cases";

/**
 * Evals de las checklists contra los modelos de verdad. Igual que los de Milo y proyectos, no
 * entran en `npm test`: gastan dinero y dependen de un tercero.
 *
 *   npm run eval:checklists
 *   npm run eval:checklists -- --filter gimnasio
 *   npm run eval:checklists -- --provider ollama
 *   npm run eval:checklists -- --transcript /tmp/checklists
 */
const FILTER = process.env.EVAL_FILTER;
const PROVIDER = process.env.EVAL_PROVIDER;
if (PROVIDER) process.env.AI_PROVIDER_ORDER = PROVIDER;

const hasAnyProvider = Boolean(process.env.GROQ_API_KEY || process.env.OLLAMA_API_KEY);
const matches = (name: string) => !FILTER || name.toLowerCase().includes(FILTER.toLowerCase());

let tokens = { input: 0, output: 0, calls: 0 };
const deps: ChecklistAiDeps = {
  complete,
  logUsage: async ({ completion }) => {
    tokens = {
      input: tokens.input + completion.usage.inputTokens,
      output: tokens.output + completion.usage.outputTokens,
      calls: tokens.calls + 1
    };
  }
};

const transcript: Array<Record<string, unknown>> = [];

if (!hasAnyProvider) {
  describe("checklist eval", () => {
    it("needs a provider key", () => {
      expect.fail("No GROQ_API_KEY and no OLLAMA_API_KEY. Copy .env.example to .env.local.");
    });
  });
} else {
  describe("lista inicial de una actividad", () => {
    for (const testCase of GENERATE_CASES.filter((c) => matches(c.name))) {
      it(testCase.name, async () => {
        const list = await generateInitialList(
          "eval",
          { activityKey: testCase.activityKey, title: testCase.title, facts: testCase.facts, season: testCase.season, weather: testCase.weather, language: testCase.language },
          deps
        );
        // Lo que ve el usuario ese día: la misma selección que usa la app.
        const today = selectItems(list, { season: testCase.season, weather: testCase.weather }).map((p) => p.item.text);
        transcript.push({ case: testCase.name, list, today });

        const e = testCase.expect;
        expect(today.length, `entraron ${today.length} ítems hoy: ${today.join(" | ")}`).toBeGreaterThanOrEqual(e.minItems);
        for (const pattern of e.include) {
          expect(today.some((text) => pattern.test(text)), `falta ${pattern} en la lista de hoy: ${today.join(" | ")}`).toBe(true);
        }
        for (const pattern of e.exclude) {
          const hit = today.find((text) => pattern.test(text));
          expect(hit, `no debería estar hoy: "${hit}" (${today.join(" | ")})`).toBeUndefined();
        }
        for (const conditional of e.storedConditional ?? []) {
          const stored = list.find((i) => conditional.pattern.test(i.text));
          expect(stored, `la lista guardada no trae ${conditional.pattern} para otro día`).toBeDefined();
          if (conditional.season) expect(stored?.season, `"${stored?.text}" debería llevar la época`).toBe(conditional.season);
          if (conditional.weather) expect(stored?.weather, `"${stored?.text}" debería llevar el clima`).toBe(conditional.weather);
        }

        // Ítems cortos, sin repetidos y nada sensible.
        for (const item of list) {
          expect(item.text.length, `ítem largo: "${item.text}"`).toBeLessThanOrEqual(ITEM_MAX_LENGTH);
          expect(item.text.split(/\s+/).length, `ítem de más de 6 palabras: "${item.text}"`).toBeLessThanOrEqual(6);
          expect(sensitiveCategory(item.text), `ítem sensible: "${item.text}"`).toBeNull();
        }
        // Los condicionales existen: sin ellos la lista es la misma todos los días.
        expect(list.some((i) => i.season || i.weather), "ningún ítem lleva época o clima").toBe(true);
      });
    }
  });

  describe("qué es una actividad", () => {
    it("clasifica los títulos en un lote", async () => {
      const cases = CLASSIFY_CASES.filter((c) => matches(c.title) || !FILTER);
      const result = await classifyTitles("eval", cases.map((c) => c.title), deps);
      transcript.push({ stage: "classify", result: Object.fromEntries(result) });

      const wrong: string[] = [];
      for (const c of cases) {
        const got = result.get(normalizeTitle(c.title)) ?? null;
        const ok = c.expected === "none" ? got === null : c.expected === "any" ? got !== null : got === c.expected;
        if (!ok) wrong.push(`"${c.title}": esperaba ${c.expected}, dio ${got}`);
      }
      // Un mandado marcado como actividad es peor que una actividad que se pierde: se exige cero de esos.
      const errands = wrong.filter((w) => /esperaba none/.test(w));
      expect(errands, `mandados marcados como actividad:\n${errands.join("\n")}`).toEqual([]);
      expect(wrong, `mal clasificados:\n${wrong.join("\n")}`).toEqual([]);
    });
  });

  afterAll(() => {
    console.log(`\n[checklist eval] ${tokens.calls} llamadas, ${tokens.input.toLocaleString("es-AR")} tokens de entrada, ${tokens.output.toLocaleString("es-AR")} de salida.`);
    if (process.env.EVAL_TRANSCRIPT) {
      mkdirSync(resolve(process.env.EVAL_TRANSCRIPT), { recursive: true });
      writeFileSync(resolve(process.env.EVAL_TRANSCRIPT, "checklist-eval.json"), JSON.stringify(transcript, null, 2));
    }
  });
}
