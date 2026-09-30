import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { complete } from "@/lib/ai/complete";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { runIntake, runPlan, type ProjectAiDeps } from "@/lib/project-ai";
import { draftProject, DRAFT_PROJECT_ID, planProjects } from "@/lib/project-scheduling";
import { FIRST_SUBTASK_MAX_MIN } from "@/lib/project-schema";
import { CASES, TODAY, type ProjectCase } from "./project-cases";

/**
 * Evals de la calidad de las preguntas y de las subtareas, contra los modelos de verdad.
 * Igual que el eval de Milo, no entra en `npm test`: gasta dinero y depende de un tercero.
 *
 *   npm run eval:projects
 *   npm run eval:projects -- --filter mudanza
 *   npm run eval:projects -- --provider ollama
 *   npm run eval:projects -- --transcript /tmp/proyectos
 */
const FILTER = process.env.EVAL_FILTER;
const PROVIDER = process.env.EVAL_PROVIDER;
if (PROVIDER) process.env.AI_PROVIDER_ORDER = PROVIDER;

const selected = FILTER ? CASES.filter((c) => c.name.toLowerCase().includes(FILTER.toLowerCase())) : CASES;
const hasAnyProvider = Boolean(process.env.GROQ_API_KEY || process.env.OLLAMA_API_KEY);

/** Sin base: los tokens se cuentan en memoria y se imprimen al final. */
let tokens = { input: 0, output: 0, calls: 0 };
const deps: ProjectAiDeps = {
  complete,
  logUsage: async ({ completion }) => {
    tokens = {
      input: tokens.input + completion.usage.inputTokens,
      output: tokens.output + completion.usage.outputTokens,
      calls: tokens.calls + 1
    };
  }
};

const REVIEW = /revis|correc|review|repaso final|ajustes finales|pulir/i;
/** Verbos vagos: "Avanzar con el TP" no dice cuándo está hecho. */
const VAGUE = /^(avanzar|trabajar|seguir|continuar|hacer (el|la) (tp|trabajo|proyecto)|terminar (el|la) (tp|trabajo|proyecto))\b/i;

const transcript: Array<Record<string, unknown>> = [];

if (!hasAnyProvider) {
  describe("project eval", () => {
    it("needs a provider key", () => {
      expect.fail("No GROQ_API_KEY and no OLLAMA_API_KEY. Copy .env.example to .env.local.");
    });
  });
} else {
  const context = (testCase: ProjectCase) => ({
    ...testCase.project,
    contextSummary: testCase.project.contextSummary ?? "",
    today: TODAY,
    availability: DEFAULT_AVAILABILITY,
    language: "Spanish"
  });

  describe.each(selected)("$name", (testCase) => {
    it("hace las preguntas justas", async () => {
      const { expect: e } = testCase;
      const intake = await runIntake("eval", { ...context(testCase), deadline: testCase.project.deadline }, deps);
      transcript.push({ case: testCase.name, stage: "intake", intake });

      expect(intake.understanding.length).toBeGreaterThan(20);
      expect(intake.questions.length, `preguntó ${intake.questions.length}`).toBeGreaterThanOrEqual(e.questions.min);
      expect(intake.questions.length, `preguntó ${intake.questions.length}`).toBeLessThanOrEqual(e.questions.max);

      for (const q of intake.questions) {
        expect(q.why.length, `"${q.text}" no explica por qué`).toBeGreaterThan(0);
      }
      const texts = intake.questions.map((q) => q.text.toLowerCase());
      expect(new Set(texts).size, "preguntas repetidas").toBe(texts.length);

      if (e.questionTopics && e.questions.min > 0) {
        const hit = intake.questions.some((q) => e.questionTopics!.some((re) => re.test(`${q.text} ${q.why}`)));
        expect(hit, `ninguna pregunta toca lo que cambia el plan: ${texts.join(" | ")}`).toBe(true);
      }
    });

    it("divide en subtareas concretas que entran", async () => {
      const { expect: e } = testCase;
      const answers = testCase.answers ?? [];
      const { subtasks, warnings } = await runPlan(
        "eval",
        { ...context(testCase), understanding: `Proyecto: ${testCase.project.title}`, answers },
        deps
      );
      transcript.push({ case: testCase.name, stage: "plan", subtasks, warnings });

      // La validación (DAG, rangos, ids) ya corrió dentro de runPlan: si llegó acá, es válido.
      expect(subtasks.length).toBeGreaterThanOrEqual(e.subtasks.min);
      expect(subtasks.length).toBeLessThanOrEqual(e.subtasks.max);

      // La primera se arranca hoy en menos de 30 minutos y sin depender de nada.
      const starter = subtasks.find((s) => s.dependsOn.length === 0 && s.estimateMin <= FIRST_SUBTASK_MAX_MIN);
      expect(starter, `ninguna subtarea arranca hoy en ≤${FIRST_SUBTASK_MAX_MIN} min: ${warnings.join(" ")}`).toBeDefined();

      // Concretas: nada de "Avanzar con el TP" ni títulos de una palabra.
      for (const s of subtasks) {
        expect(VAGUE.test(s.title), `título vago: "${s.title}"`).toBe(false);
        expect(s.title.trim().split(/\s+/).length, `título demasiado corto: "${s.title}"`).toBeGreaterThanOrEqual(2);
      }

      // Revisión final, y que algo sea un entregable.
      expect(subtasks.some((s) => REVIEW.test(s.title)), "no hay una subtarea de revisión").toBe(true);
      // La revisión va cerca del final: depende de algo o nada depende de ella salvo el margen.
      expect(subtasks.some((s) => s.deliverable), "ninguna subtarea marcada como entregable").toBe(true);

      // Cubre el proyecto entero.
      const all = subtasks.map((s) => s.title).join(" | ");
      for (const re of e.coverage) expect(re.test(all), `no cubre ${re}: ${all}`).toBe(true);

      // No hay una subtarea que se lleve casi todo el proyecto.
      const total = subtasks.reduce((n, s) => n + s.estimateMin, 0);
      expect(Math.max(...subtasks.map((s) => s.estimateMin)) / total).toBeLessThan(0.5);

      // El scheduler, con la disponibilidad por defecto, lo hace entrar.
      const result = planProjects({
        today: TODAY, availability: DEFAULT_AVAILABILITY, overrides: {}, tasks: [], previousSessions: [],
        projects: [draftProject(testCase.project.deadline, null, subtasks)], inflation: 1.3
      });
      const plan = result.perProject[DRAFT_PROJECT_ID];
      expect(plan.feasible, `no entra: faltan ${plan.shortfallMin} min de ${Math.round(total * 1.3)}`).toBe(e.feasible);
    });
  });

  afterAll(() => {
    console.log(`\n[project eval] ${tokens.calls} llamadas, ${tokens.input.toLocaleString("es-AR")} tokens de entrada, ${tokens.output.toLocaleString("es-AR")} de salida.`);
    if (process.env.EVAL_TRANSCRIPT) {
      mkdirSync(resolve(process.env.EVAL_TRANSCRIPT), { recursive: true });
      writeFileSync(resolve(process.env.EVAL_TRANSCRIPT, "project-eval.json"), JSON.stringify(transcript, null, 2));
    }
  });
}
