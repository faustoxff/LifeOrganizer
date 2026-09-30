import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { chainSupportsTools } from "@/lib/ai/registry";
import { DEFAULT_AVAILABILITY } from "@/lib/availability";
import { chatWithMilo, classifyChatFailure } from "@/lib/milo";
import { runMiloAgent } from "@/lib/milo-agent";
import { buildTaskPromptParts } from "@/lib/milo-chat-prompt";
import type { FactsPort, ScheduleData, ToolContext } from "@/lib/milo-tools";
import { parseTaskActions } from "@/lib/task-actions";
import { CASES, NOW, type EvalCase } from "./milo-cases";
import type { Task, TaskInput } from "@/types/task";

/**
 * Configuration arrives as environment variables, never as CLI arguments.
 *
 * This file used to parse `process.argv` for `--filter`, `--repeat`, `--model`
 * and `--provider`, and that code could never have fired: vitest rejects
 * unknown options before the run starts, and the args that survive a `--`
 * separator are not in `process.argv` inside the test worker. Every documented
 * run silently fell back to the defaults — both models, one repeat, no filter.
 *
 * `scripts/eval-milo.mjs` translates the CLI into these variables, and
 * `npm run eval:milo -- --filter x` works. Read from env only from here on, so
 * the two can never drift apart again.
 */
const FILTER = process.env.EVAL_FILTER;
const REPEAT = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));

/**
 * Pin the eval to one provider.
 *
 * The chain normally prefers Groq and falls over to Ollama Cloud. That is
 * correct in production and wrong in a measurement: if half the cases run on
 * one model and half on another, a regression in either looks like noise, and a
 * "passing" run may never have touched the code you changed.
 *
 *   npm run eval:milo -- --provider groq
 *   npm run eval:milo -- --provider ollama
 */
const PROVIDER = process.env.EVAL_PROVIDER;
if (PROVIDER) process.env.AI_PROVIDER_ORDER = PROVIDER;

/**
 * Which path Milo takes, so a change can be measured against the one before it.
 *
 *   auto    what production does: tools when a configured provider supports them,
 *           the TASKS_ACTION text block otherwise (default)
 *   tools   fail loudly if no provider can take tools
 *   legacy  force the TASKS_ACTION path. This is the baseline the tools path must not
 *           be worse than: run both and compare the pass counts.
 *
 *   npm run eval:milo -- --mode legacy
 */
const MODE = process.env.EVAL_MODE ?? "auto";
if (!["auto", "tools", "legacy"].includes(MODE)) {
  throw new Error(`EVAL_MODE inválido: "${MODE}". Usá auto, tools o legacy.`);
}

// The Groq plan allows 200k tokens per DAY for the whole account. A full run is
// ~70 calls at ~1.8k tokens each, so an unthrottled loop can spend the day and
// leave the live app unable to answer. Fail loudly instead of silently 429ing
// halfway through.
//
// The guard lifts on Ollama, which is billed per token and has no daily ceiling.
// Removing it there would be wrong too — an eval on a paid provider can still
// run up a real bill — so it is kept, just sized for a paid run.
const ON_GROQ = (PROVIDER ?? "groq").includes("groq");
const RUN_BUDGET_TOKENS = ON_GROQ ? 180_000 : 1_000_000;
let tokensSpent = 0;

const selected = FILTER
  ? CASES.filter((c) => c.name.toLowerCase().includes(FILTER.toLowerCase()))
  : CASES;

/** At least one provider in the pinned chain has to have a key. */
const hasAnyProvider = Boolean(process.env.GROQ_API_KEY || process.env.OLLAMA_API_KEY);

if (!hasAnyProvider) {
  describe("milo eval", () => {
    it("needs a provider key", () => {
      expect.fail(
        "No GROQ_API_KEY and no OLLAMA_API_KEY. Copy .env.example to .env.local."
      );
    });
  });
} else {
  const transcript: Array<Record<string, unknown>> = [];
  /** Set once the pinned provider is out of budget; the rest of the run skips. */
  let quotaExhausted = false;

  /** The agenda a case's own tasks imply, so `get_schedule` and `plan_week` see what the prompt shows. */
  const scheduleFor = (tasks: Task[], busy: NonNullable<EvalCase["busy"]> = [], now: Date = NOW): ScheduleData => ({
    tasks,
    sessions: [],
    availability: DEFAULT_AVAILABILITY,
    overrides: {},
    inflation: 1,
    timeZone: "UTC",
    busyBlocks: busy.map((b, index) => ({
      id: `eval:${index}`,
      title: b.title,
      source: b.source,
      importance: b.importance ?? "normal",
      prepMin: b.prepMin ?? 0,
      start: new Date(now.getTime() + b.startsInMin * 60_000).toISOString(),
      end: new Date(now.getTime() + (b.startsInMin + b.durationMin) * 60_000).toISOString()
    }))
  });

  /** Whether this case runs through tools, exactly as the route decides it. */
  const usesTools = (testCase: EvalCase, isPro: boolean) => {
    const canCreateTasks = (testCase.plan ?? "pro") !== "free";
    if (!canCreateTasks || MODE === "legacy") return false;
    const supported = chainSupportsTools(isPro ? "pro" : "standard");
    if (MODE === "tools" && !supported) {
      throw new Error("EVAL_MODE=tools pero ningún proveedor configurado soporta tools con este modelo.");
    }
    return supported;
  };

  type Outcome = {
    raw: string;
    text: string;
    tasks: TaskInput[];
    error: string | null;
    usage: number;
    via: "tools" | "legacy";
    toolsUsed: string[];
    toolCalls: Array<{ name: string; arguments: string }>;
    asked: boolean;
    proposalDays: number;
    weekStart: string | null;
    /** Hechos que Milo guardó / propuso. En el camino de texto no existen. */
    factsSaved: Array<{ key: string; value: string }>;
    factProposals: Array<{ key: string; value: string }>;
  };

  const runCase = async (testCase: EvalCase, isPro: boolean): Promise<Outcome> => {
    const now = testCase.now ?? NOW;
    const canCreateTasks = (testCase.plan ?? "pro") !== "free";
    const viaTools = usesTools(testCase, isPro);
    const history = (testCase.history ?? []).map((m) => ({
      role: m.role === "milo" ? ("assistant" as const) : ("user" as const),
      content: m.content
    }));

    // Built the same way the route builds it, split included. An eval that sent
    // a different prompt than production would be measuring the wrong thing.
    const { static: staticContext, dynamic: dynamicContext } = buildTaskPromptParts({
      tasks: testCase.tasks ?? [],
      pendingTaskActions: testCase.pending ?? [],
      canCreateTasks,
      userMemory: testCase.userMemory ?? "",
      now,
      mode: canCreateTasks && !viaTools ? "legacy" : "tools"
    });
    const promptTokens = Math.round((staticContext.length + dynamicContext.length) / 3.8);

    if (viaTools) {
      // Sin base: un puerto de hechos en memoria. Lo que se mide es qué decide guardar Milo y qué
      // rechaza el servidor (la cita, el filtro de sensibles), que es código real.
      const facts: FactsPort = {
        list: async () => [],
        save: async () => ({ status: "saved" })
      };
      const toolCtx: ToolContext = {
        today: now.toISOString().split("T")[0],
        now,
        userMessage: testCase.message,
        turn: { factCalls: 0 },
        facts,
        load: async () => scheduleFor(testCase.tasks ?? [], testCase.busy, now)
      };
      const result = await runMiloAgent({
        message: testCase.message,
        contextStatic: staticContext,
        context: dynamicContext,
        history,
        isPro,
        tools: toolCtx
      });
      return {
        raw: result.text,
        text: result.text,
        tasks: result.taskActions,
        error: null,
        // One prompt per round, plus what the tools returned; a rough figure like the legacy one.
        usage: promptTokens * result.rounds + Math.round(result.text.length / 3.8) + 250 * result.rounds,
        via: "tools",
        toolsUsed: result.toolsUsed,
        toolCalls: result.toolCalls,
        asked: result.toolsUsed.includes("ask_user"),
        proposalDays: result.proposal ? new Set(result.taskActions.map((t) => t.dueDate)).size : 0,
        weekStart: result.proposal?.weekStart ?? null,
        factsSaved: result.factsSaved,
        factProposals: result.factProposals
      };
    }

    const { content } = await chatWithMilo({
      message: testCase.message,
      contextStatic: staticContext,
      context: dynamicContext,
      history,
      isPro
    });

    const parsed = parseTaskActions(content, now);
    return {
      raw: content,
      text: parsed.text,
      tasks: parsed.taskActions,
      error: parsed.error,
      usage: promptTokens + Math.round(content.length / 3.8) + 250,
      via: "legacy",
      toolsUsed: [],
      toolCalls: [],
      asked: false,
      proposalDays: 0,
      weekStart: null,
      factsSaved: [],
      factProposals: []
    };
  };

  const fail = (msg: string) => {
    throw new Error(msg);
  };

  /**
   * Discomfort checks that apply to EVERY case, whatever it expects. These came
   * out of the first real run: the pro model told users "he creado la tarea" when
   * nothing existed yet (the user still has to confirm), it invented tasks when
   * someone only asked how they were doing, and it slipped into "¿quieres?" in an
   * app that is entirely voseo.
   */
  const GLOBAL_CHECKS: Array<{ name: string; test: (text: string) => string | null }> = [
    {
      name: "no-falsa-afirmacion",
      test: (text) => {
        const m = text.match(
          /\b(he creado|he agregado|he añadido|he agendado|listo,? (ya )?agendad[oa]|ya (te lo )?(guardé|agendé|anoté)|queda (registrada|agendada|guardada)|añadí un recordatorio|creé la tarea)\b/i
        );
        return m
          ? `told the user the task already exists ("${m[0]}"), but nothing exists until they confirm`
          : null;
      }
    },
    {
      name: "sin-tuteo",
      test: (text) => {
        const m = text.match(/\b(tienes|puedes|quieres|necesitas|elige|hazlo)\b/i);
        return m ? `used tuteo ("${m[0]}") in a voseo-only app` : null;
      }
    },
    {
      name: "sin-json-filtrado",
      test: (text) => {
        if (/"title"\s*:/.test(text)) return "raw task JSON leaked into the visible reply";
        if (/```/.test(text)) return "a code fence leaked into the visible reply";
        return null;
      }
    }
  ];

  const check = (testCase: EvalCase, out: Outcome) => {
    const e = testCase.expectation;
    const titles = out.tasks.map((t) => t.title.toLowerCase());
    const dates = out.tasks.map((t) => t.dueDate);

    // The block was present but unusable: this is the exact failure the report
    // came from, so it must never be tolerated silently.
    if (out.error) {
      fail(`milo emitted a TASKS_ACTION block that we could not parse: ${out.error}`);
    }

    for (const global of GLOBAL_CHECKS) {
      const problem = global.test(out.text);
      if (problem) {
        fail(`[${global.name}] ${problem}. reply: ${JSON.stringify(out.text.slice(0, 220))}`);
      }
    }
    if (out.text.includes("TASKS_ACTION")) fail("the machine block leaked into the visible reply");

    // ---- Tools path only: which tool, and whether it asked instead of guessing. ----
    if (out.via === "tools") {
      if (e.askUser) {
        if (!out.asked) fail(`expected ask_user (a needed detail is missing), got tools=[${out.toolsUsed.join(", ")}] reply: ${JSON.stringify(out.text.slice(0, 160))}`);
        if (out.tasks.length > 0) fail(`asked a question but also proposed ${out.tasks.length} item(s)`);
      }
      if (e.tool && !out.toolsUsed.includes(e.tool)) {
        fail(`expected tool ${e.tool}, got tools=[${out.toolsUsed.join(", ")}]`);
      }
      if (e.nowArgs) {
        const call = out.toolCalls.find((c) => c.name === "what_should_i_do_now");
        let args: Record<string, unknown> = {};
        try { args = call ? (JSON.parse(call.arguments) as Record<string, unknown>) : {}; } catch { /* argumentos rotos: cuentan como ausentes */ }
        const want = e.nowArgs;
        if (want.availableMin !== undefined) {
          const got = args.availableMin;
          if (want.availableMin === "absent" ? got !== undefined && got !== null : got !== want.availableMin) {
            fail(`what_should_i_do_now: expected availableMin ${want.availableMin === "absent" ? "absent (the user did not say how long)" : want.availableMin}, got ${JSON.stringify(got)}`);
          }
        }
        if (want.energy !== undefined) {
          const got = args.energy;
          if (want.energy === "absent" ? got !== undefined && got !== null : got !== want.energy) {
            fail(`what_should_i_do_now: expected energy ${want.energy}, got ${JSON.stringify(got)}`);
          }
        }
      }
      if (e.distinctDays !== undefined && out.proposalDays < e.distinctDays) {
        fail(`expected the week spread over at least ${e.distinctDays} days, got ${out.proposalDays}`);
      }
      if (e.weekStart && out.weekStart !== e.weekStart) {
        fail(`expected the plan to start ${e.weekStart}, got ${out.weekStart}`);
      }
      if (e.savesFact) {
        const hit = out.factsSaved.some((f) => e.savesFact!.test(`${f.key} ${f.value}`));
        if (!hit) {
          fail(`expected a saved fact matching ${e.savesFact}, got saved=[${out.factsSaved.map((f) => `${f.key}=${f.value}`).join(" | ")}] proposed=[${out.factProposals.map((f) => f.key).join(", ")}]`);
        }
      }
      if (e.savesNoFact && (out.factsSaved.length > 0 || out.factProposals.length > 0)) {
        const all = [...out.factsSaved, ...out.factProposals].map((f) => `${f.key}=${f.value}`);
        fail(`expected no fact to be saved or proposed, got [${all.join(" | ")}]`);
      }
    }

    // ---- Both paths: nothing forgotten, fixed items on their date, the reply names what it should. ----
    if (e.minTasks !== undefined && out.tasks.length < e.minTasks) {
      fail(`expected at least ${e.minTasks} item(s) but got ${out.tasks.length}: [${titles.join(" | ")}] — something the user said was left out`);
    }
    for (const [needle, date] of Object.entries(e.titleOn ?? {})) {
      const hit = out.tasks.find((t) => t.title.toLowerCase().includes(needle.toLowerCase()));
      if (!hit) fail(`expected an item containing "${needle}" on ${date}, got [${titles.join(" | ")}]`);
      else if (hit.dueDate !== date) fail(`expected "${hit.title}" on ${date}, got ${hit.dueDate}`);
    }
    for (const [needle, date] of Object.entries(e.titleOnOrBefore ?? {})) {
      const hit = out.tasks.find((t) => t.title.toLowerCase().includes(needle.toLowerCase()));
      if (!hit) fail(`expected an item containing "${needle}" on or before ${date}, got [${titles.join(" | ")}]`);
      else if (hit.dueDate > date) fail(`expected "${hit.title}" on or before ${date}, got ${hit.dueDate}`);
    }
    for (const needle of e.mentions ?? []) {
      if (!out.text.toLowerCase().includes(needle.toLowerCase())) {
        fail(`expected the reply to mention "${needle}". reply: ${JSON.stringify(out.text.slice(0, 220))}`);
      }
    }

    if (e.tasks === "some") {
      if (out.tasks.length === 0) {
        fail(`expected at least one task, got none. reply: ${JSON.stringify(out.text)}`);
      }
      for (const t of e.titles ?? []) {
        if (!titles.some((title) => title.includes(t.toLowerCase()))) {
          fail(`expected a task containing "${t}", got [${titles.join(" | ")}]`);
        }
      }
      for (const d of e.dates ?? []) {
        if (!dates.includes(d)) {
          fail(`expected a task due ${d}, got [${dates.join(" | ")}]`);
        }
      }
      for (const d of e.datesOnOrBefore ?? []) {
        if (!dates.some((actual) => actual <= d)) {
          fail(`expected a task on or before ${d}, got [${dates.join(" | ")}]`);
        }
      }
      for (const weekday of e.weekdays ?? []) {
        const hit =
          // A recurrence carries its weekdays in `repeat`, not in the dates.
          out.tasks.some((t) => t.repeat?.weekdays?.includes(weekday)) ||
          dates.some((actual) => {
            // Parse as UTC so the weekday is read off the date string itself and
            // not shifted by the runner's timezone.
            const d = new Date(`${actual}T00:00:00Z`);
            return !Number.isNaN(d.getTime()) && d.getUTCDay() === weekday;
          });
        if (!hit) {
          const days = dates.map((a) => `${a}(${new Date(`${a}T00:00:00Z`).getUTCDay()})`);
          fail(`expected a task on weekday ${weekday}, got [${days.join(" | ")}]`);
        }
      }
      if (e.repeat) {
        const wanted = e.repeat;
        const hit = out.tasks.some(
          (t) =>
            t.repeat?.freq === wanted.freq &&
            (wanted.weekdays ?? []).every((d) => t.repeat?.weekdays?.includes(d)) &&
            (wanted.monthDay === undefined || t.repeat?.monthDay === wanted.monthDay)
        );
        if (!hit) {
          const got = out.tasks.map((t) => JSON.stringify(t.repeat ?? null));
          fail(`expected an item with repeat ${JSON.stringify(wanted)}, got [${got.join(" | ")}]`);
        }
      }
      if (e.maxTasks !== undefined && out.tasks.length > e.maxTasks) {
        fail(`expected at most ${e.maxTasks} item(s) but got ${out.tasks.length}: a recurrence must be ONE item with repeat, not one per occurrence`);
      }
    } else if (e.tasks === "none" || e.tasks === "either") {
      if (e.tasks === "none" && out.tasks.length > 0) {
        fail(`expected no tasks, got ${out.tasks.length}: [${titles.join(" | ")}]`);
      }
      if (out.text.includes("TASKS_ACTION")) {
        fail("the machine block leaked into the visible reply");
      }
      if (e.mentionsUpgrade && !/\/plans|plus|pro|upgrade/i.test(out.text)) {
        fail(`free-plan reply should mention the upgrade path. got: ${JSON.stringify(out.text)}`);
      }
    }

    if (e.maxChars && out.text.length > e.maxChars) {
      fail(`reply too long: ${out.text.length} chars, budget ${e.maxChars}`);
    }
  };

  /**
   * Name the model that will actually answer, so a transcript says which engine
   * produced a reply. With two providers in the chain, "pro model" is not enough
   * to tell a Groq regression from an Ollama one.
   */
  const modelLabel = (isPro: boolean) => {
    const onOllama = Boolean(PROVIDER?.includes("ollama"));
    if (onOllama) {
      return isPro
        ? process.env.OLLAMA_PRO_MODEL ?? "ollama pro"
        : process.env.OLLAMA_MODEL ?? "ollama standard";
    }
    return isPro
      ? process.env.GROQ_PRO_MODEL ?? "pro model"
      : process.env.GROQ_MODEL ?? "default model";
  };

  // Groq enforces 200k tokens per day PER MODEL. Targeting one model halves the
  // cost of a run and lets you verify the non-pro experience on its own.
  //   --model default | pro | both   (default: both)
  const MODEL_TARGET = process.env.EVAL_MODEL ?? "both";
  const targets: boolean[] =
    MODEL_TARGET === "default" ? [false] : MODEL_TARGET === "pro" ? [true] : [false, true];

  for (const testCase of selected) {
    for (const isPro of targets) {
      for (let run = 0; run < REPEAT; run++) {
        const label =
          REPEAT > 1
            ? `${testCase.name} [${modelLabel(isPro)} #${run + 1}]`
            : `${testCase.name} [${modelLabel(isPro)}]`;

        it(label, async (ctx) => {
          // Once the provider is out of quota, every remaining case fails the
          // same way. Reporting 70 identical "quarantined" failures buries the
          // one line that matters and makes the run look like a regression.
          if (quotaExhausted) {
            ctx.skip();
            return;
          }

          if (tokensSpent > RUN_BUDGET_TOKENS) {
            throw new Error(
              `eval budget guard: already spent ~${tokensSpent} of ${RUN_BUDGET_TOKENS} daily tokens. ` +
                `Re-run tomorrow, or narrow it with --filter. The live app shares this quota.`
            );
          }

          // ask_user and friends do not exist on the text path: nothing to measure there.
          if (testCase.toolsOnly && !usesTools(testCase, isPro)) {
            ctx.skip();
            return;
          }

          let out: Outcome;
          try {
            out = await runCase(testCase, isPro);
          } catch (error) {
            if (classifyChatFailure(error).busy) {
              // Groq allows 200k tokens per day for the whole account, and the
              // live app shares it. Once it is gone the run cannot continue, so
              // say so once and skip the rest rather than producing a wall of
              // identical failures.
              quotaExhausted = true;
              throw new Error(
                `${label}: se agotó la cuota diaria de Groq.\n` +
                  `  Re-run mañana, o:--filter para un caso puntual.\n` +
                  `  Con OLLAMA_API_KEY: --provider ollama (cobrado por token, sin tope diario).`
              );
            }
            throw error;
          }

          tokensSpent += out.usage;
          const entry: Record<string, unknown> = {
            case: testCase.name,
            model: modelLabel(isPro),
            message: testCase.message,
            via: out.via,
            toolsUsed: out.toolsUsed,
            factsSaved: out.factsSaved,
            factProposals: out.factProposals,
            raw: out.raw,
            visible: out.text,
            tasks: out.tasks,
            parseError: out.error,
            failure: null as string | null
          };
          transcript.push(entry);
          try {
            check(testCase, out);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            entry.failure = reason;
            console.error(`\n--- ${label} ---`);
            console.error(`user:  ${testCase.message}`);
            console.error(`milo:  ${out.raw}`);
            console.error(`parsed: ${out.tasks.length} task(s), via=${out.via}, tools=[${out.toolsUsed.join(", ")}], error=${out.error ?? "none"}`);
            throw err;
          }
        });
      }
    }
  }

  afterAll(() => {
    console.log(
      `\n[milo eval] ~${tokensSpent.toLocaleString("es-AR")} tokens estimados` +
        (ON_GROQ ? " de los 200.000 diarios de Groq." : " (provider con pago por token).")
    );
    if (process.env.EVAL_TRANSCRIPT) {
      mkdirSync(resolve(process.env.EVAL_TRANSCRIPT), { recursive: true });
      writeFileSync(
        resolve(process.env.EVAL_TRANSCRIPT, "milo-eval.json"),
        JSON.stringify(transcript, null, 2)
      );
    }
  });
}
