import { describe, expect, it } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { learnInflation } from "@/lib/estimate-learning";
import type { Completion } from "@/lib/ai/types";
import { runIntake, runPlan, type ProjectAiDeps } from "@/lib/project-ai";
import { addExtraMinutes, draftProject, groupByDay, planProjects, unprefixDraftSessions, DRAFT_PROJECT_ID } from "@/lib/project-scheduling";
import type { ProjectContext } from "@/lib/project-prompts";
import { parseAnswers } from "@/lib/project-input";

/**
 * De punta a punta sin red ni base: intake -> respuestas del usuario -> plan de la IA ->
 * scheduler. La IA está simulada; lo que se comprueba es que las piezas encajan y que las
 * fechas las decide el scheduler.
 */

const TODAY = "2026-09-28"; // lunes
const done = (content: string): Completion => ({ content, finishReason: "stop", model: "m", provider: "p", usage: { inputTokens: 900, outputTokens: 500 } });

function ai(replies: string[]) {
  const seen: string[] = [];
  const deps: ProjectAiDeps = {
    complete: async (request) => {
      seen.push(request.messages.map((m) => m.content).join("\n---\n"));
      return done(replies.shift() as string);
    },
    logUsage: async () => {}
  };
  return { deps, seen };
}

const ctx = (over: Partial<ProjectContext> = {}): ProjectContext => ({
  title: "TP final de Álgebra", description: "Consigna: 5 ejercicios y un informe. Entrega el 15/10.",
  deadline: "2026-10-15", today: TODAY, availability: DEFAULT_AVAILABILITY, language: "Spanish", ...over
});

const INTAKE = JSON.stringify({
  understanding: "Es un TP individual con 5 ejercicios y un informe, a entregar el 15/10.",
  questions: [
    { id: "q1", text: "¿Ya resolviste algún ejercicio?", why: "Cambia cuánto falta", type: "text" },
    { id: "q2", text: "¿Es individual o grupal?", why: "Reparte el trabajo", type: "choice", options: ["Individual", "Grupal"] }
  ]
});

const PLAN = JSON.stringify({
  subtasks: [
    { tempId: "t1", title: "Leer la consigna y listar lo que hay que entregar", estimateMin: 20, dependsOn: [] },
    { tempId: "t2", title: "Resolver los ejercicios 1 y 2", estimateMin: 90, dependsOn: ["t1"] },
    { tempId: "t3", title: "Resolver los ejercicios 3 a 5", estimateMin: 120, dependsOn: ["t1"] },
    { tempId: "t4", title: "Escribir el informe", estimateMin: 120, dependsOn: ["t2", "t3"], deliverable: true },
    { tempId: "t5", title: "Revisión y correcciones", estimateMin: 45, dependsOn: ["t4"], deliverable: true },
    { tempId: "t6", title: "Margen para imprevistos del TP", estimateMin: 30, dependsOn: ["t5"] }
  ].map((s) => ({ ...s, date: "2026-01-01" })) // una IA que se mete a poner fechas
});

async function pipeline(over: { availability?: typeof DEFAULT_AVAILABILITY; deadline?: string; inflation?: number } = {}) {
  const { deps, seen } = ai([INTAKE, PLAN]);
  const context = ctx({ ...(over.deadline ? { deadline: over.deadline } : {}), ...(over.availability ? { availability: over.availability } : {}) });

  const intake = await runIntake("u1", context, deps);
  const answers = parseAnswers(intake.questions.map((q, i) => ({ id: q.id, question: q.text, answer: i === 0 ? "Hice el 1" : "Individual" })));
  const { subtasks } = await runPlan("u1", { ...context, understanding: intake.understanding, answers }, deps);

  const result = planProjects({
    today: TODAY, availability: context.availability, overrides: {}, tasks: [], previousSessions: [],
    projects: [draftProject(context.deadline, null, subtasks)], inflation: over.inflation ?? 1.3
  });
  return { intake, answers, subtasks, result, seen };
}

describe("intake -> plan -> schedule", () => {
  it("las respuestas del usuario llegan al prompt del plan", async () => {
    const { seen, answers } = await pipeline();
    expect(answers).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("¿Ya resolviste algún ejercicio? -> Hice el 1");
    expect(seen[1]).toContain("Es un TP individual con 5 ejercicios");
  });

  it("un plan que entra: fechas del scheduler, dependencias respetadas, nada después del deadline", async () => {
    const { result } = await pipeline();
    const perProject = result.perProject[DRAFT_PROJECT_ID];
    expect(perProject.feasible).toBe(true);
    const sessions = unprefixDraftSessions(result.sessions);
    expect(sessions.every((s) => s.date >= TODAY && s.date <= "2026-10-15")).toBe(true);

    const dates = (id: string) => sessions.filter((s) => s.subtaskId === id).map((s) => s.date);
    expect(dates("t1")[0]).toBe(TODAY); // arranca hoy, en menos de 30 min
    expect(sessions.find((s) => s.subtaskId === "t1")!.minutes).toBeLessThanOrEqual(30);
    for (const [after, before] of [["t2", "t1"], ["t3", "t1"], ["t4", "t2"], ["t4", "t3"], ["t5", "t4"], ["t6", "t5"]]) {
      expect(dates(after)[0] > (dates(before).at(-1) as string), `${after} después de ${before}`).toBe(true);
    }
  });

  it("las fechas que la IA se atreva a poner se ignoran", async () => {
    const { subtasks, result } = await pipeline();
    for (const s of subtasks) expect(s).not.toHaveProperty("date");
    expect(unprefixDraftSessions(result.sessions).some((s) => s.date === "2026-01-01")).toBe(false);
  });

  it("aplica el factor de inflación (1.3 por defecto) a las estimaciones de la IA", async () => {
    const total = (inflation: number) => pipeline({ inflation }).then((p) => p.result.sessions.reduce((n, s) => n + s.minutes, 0));
    expect(await total(1)).toBe(20 + 90 + 120 + 120 + 45 + 30);
    expect(await total(1.3)).toBe(26 + 117 + 156 + 156 + 59 + 39);
  });

  it("usa el factor aprendido del usuario", async () => {
    const learned = learnInflation([1.6, 1.6, 1.5, 1.7, 1.6].map((r) => ({ estimateMin: 60, actualMin: Math.round(60 * r) })));
    expect(learned.factor).toBe(1.6);
    const { result } = await pipeline({ inflation: learned.factor });
    expect(result.sessions.reduce((n, s) => n + s.minutes, 0)).toBe(32 + 144 + 192 + 192 + 72 + 48);
  });

  it("agrupa por día para mostrarlo como un plan", async () => {
    const { result } = await pipeline();
    const groups = groupByDay(unprefixDraftSessions(result.sessions));
    expect(groups[0].date).toBe(TODAY);
    expect(groups.reduce((n, g) => n + g.minutes, 0)).toBe(result.sessions.reduce((n, s) => n + s.minutes, 0));
    expect(groups.map((g) => g.date)).toEqual([...groups.map((g) => g.date)].sort());
  });
});

describe("cuando no entra: se muestra antes de confirmar, con opciones", () => {
  const skinny = { ...DEFAULT_AVAILABILITY, "1": 30, "2": 30, "3": 30, "4": 30, "5": 30, "6": 0, "0": 0 };

  it("feasible=false, faltante exacto y las tres salidas", async () => {
    const { result } = await pipeline({ availability: skinny, deadline: "2026-10-08" });
    const plan = result.perProject[DRAFT_PROJECT_ID];
    expect(plan.feasible).toBe(false);
    expect(plan.shortfallMin).toBeGreaterThan(0);
    // "recortar alcance": cuántos minutos hay que sacar
    const scheduled = unprefixDraftSessions(result.sessions).reduce((n, s) => n + s.minutes, 0);
    expect(scheduled + plan.shortfallMin).toBe(26 + 117 + 156 + 156 + 59 + 39);
    // "más minutos por día" y "correr fecha"
    expect(plan.options?.extraMinPerDay).toBeGreaterThan(0);
    expect(plan.options?.achievableDeadline && plan.options.achievableDeadline > "2026-10-08").toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("INFEASIBLE");
  });

  it("cada opción, aplicada, hace que entre", async () => {
    const base = await pipeline({ availability: skinny, deadline: "2026-10-08" });
    const options = base.result.perProject[DRAFT_PROJECT_ID].options!;
    const project = (deadline: string, list = base.subtasks) => draftProject(deadline, null, list);
    const run = (availability: typeof skinny, deadline: string, list = base.subtasks) =>
      planProjects({ today: TODAY, availability, overrides: {}, tasks: [], previousSessions: [], projects: [project(deadline, list)], inflation: 1.3 }).perProject[DRAFT_PROJECT_ID];

    expect(run(addExtraMinutes(skinny, {}, options.extraMinPerDay!).availability, "2026-10-08").feasible).toBe(true);
    expect(run(skinny, options.achievableDeadline!).feasible).toBe(true);

    // recortar alcance: sacar subtareas de las últimas hasta cubrir el faltante
    const trimmed = base.subtasks.filter((s) => !["t6"].includes(s.tempId));
    const cut = run(skinny, "2026-10-08", trimmed);
    expect(cut.shortfallMin).toBeLessThan(base.result.perProject[DRAFT_PROJECT_ID].shortfallMin);
  });
});
