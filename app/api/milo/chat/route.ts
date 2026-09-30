import "server-only";
import { after, NextResponse } from "next/server";
import { chainSupportsTools } from "@/lib/ai/registry";
import { chatWithMilo, classifyChatFailure, refreshUserMemorySummary } from "@/lib/milo";
import { runMiloAgent, toolsNotSupported } from "@/lib/milo-agent";
import { buildTaskPromptParts, type PromptMode } from "@/lib/milo-chat-prompt";
import { createToolContext } from "@/lib/milo-tools-server";
import { loadPersonalContext } from "@/lib/personal-context-server";
import { normalizeTaskAction, parseTaskActions } from "@/lib/task-actions";
import { getTodayInTimeZone } from "@/lib/task-date";
import { getZonedNow } from "@/lib/task-date";
import { resolveUserTimeZone } from "@/lib/user-settings";
import { requireAuth, getUserPlan } from "@/lib/server-auth";
import { consumeDailyUsage, dailyLimitResponse } from "@/lib/usage-limits";
import { clampTasksForPrompt, HISTORY_CONTENT_LIMIT, HISTORY_MESSAGES_LIMIT } from "@/lib/prompt-input";
import { bumpMessageCount, getUserMemory, saveUserMemory, shouldRefreshMemory } from "@/lib/user-memory";
import type { FactProposal, SavedFact, WeekProposal } from "@/types/milo";
import { Task, TaskInput } from "@/types/task";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TASKS = 100;

type HistoryMessage = { role: "user" | "milo"; content: string };

type MiloChatRequest = {
  message?: string;
  tasks?: Task[];
  history?: HistoryMessage[];
  /** Los ítems de la propuesta que el usuario todavía no confirmó ni descartó. */
  pendingTaskActions?: unknown;
  /** Formato anterior (un solo ítem). Se sigue aceptando. */
  pendingTaskAction?: unknown;
};

/** Cuántos ítems de una propuesta pendiente entran al prompt. */
const MAX_PENDING_ITEMS = 25;

/**
 * Lo que el cliente dice que está pendiente va al prompt, así que se lo trata como entrada
 * no confiable: cada ítem pasa por el mismo normalizador que los que propone Milo.
 */
function readPending(body: MiloChatRequest, now: Date): TaskInput[] {
  const raw = Array.isArray(body.pendingTaskActions)
    ? body.pendingTaskActions
    : body.pendingTaskAction
      ? [body.pendingTaskAction]
      : [];
  return raw
    .slice(0, MAX_PENDING_ITEMS)
    .map((item) => normalizeTaskAction(item, now))
    .filter((item): item is TaskInput => item !== null);
}

export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const body = (await request.json()) as MiloChatRequest;
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }
  if (Array.isArray(body.tasks) && body.tasks.length > MAX_TASKS) {
    return NextResponse.json({ error: "Too many tasks" }, { status: 400 });
  }

  const plan = await getUserPlan(userId);
  const usage = await consumeDailyUsage(userId, "milo_chat", plan);
  if (!usage.allowed) return dailyLimitResponse(usage.limit, plan);

  const canCreateTasks = plan !== "free";

  const userMemory = await getUserMemory(userId);
  // Clamped, not merely counted: the count guard above stops a flood of tasks
  // but never measured a field, so 100 tasks with 50KB titles was one counted
  // call carrying megabytes of prompt the daily counter never saw.
  const tasks = clampTasksForPrompt(body.tasks, MAX_TASKS);
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory.slice(-HISTORY_MESSAGES_LIMIT).map((m) => ({
    role: (m.role === "milo" ? "assistant" : "user") as "assistant" | "user",
    content: typeof m.content === "string" ? m.content.slice(0, HISTORY_CONTENT_LIMIT) : ""
  }));

  // "Today" is the user's. On UTC the model was told tomorrow's date for hours
  // every evening, and every relative date it resolved ("mañana", "el jueves")
  // came out a day late.
  const timeZone = await resolveUserTimeZone(userId);
  const now = getZonedNow(timeZone);

  const pendingTaskActions = readPending(body, now);
  const isPro = plan === "pro";
  const tier = isPro ? "pro" : "standard";

  // Lo que Spark sabe del usuario y viene al caso. Solo para planes con tools; un fallo no frena el chat.
  const personal = canCreateTasks
    ? await loadPersonalContext(userId, { message, history, tasks, today: getTodayInTimeZone(timeZone) })
    : { facts: [], checklistHints: [] };

  const promptFor = (mode: PromptMode) =>
    buildTaskPromptParts({
      tasks,
      pendingTaskActions,
      canCreateTasks,
      userMemory,
      facts: personal.facts,
      checklistHints: personal.checklistHints,
      now,
      mode
    });

  try {
    let text = "";
    let taskActions: TaskInput[] = [];
    let proposal: WeekProposal | null = null;
    let factsSaved: SavedFact[] = [];
    let factProposals: FactProposal[] = [];
    let viaTools = false;

    // Milo llama tools cuando alguien puede crear y algún proveedor las soporta. Sin eso
    // (o si todos rechazan la request) se usa el bloque TASKS_ACTION de siempre.
    if (canCreateTasks && chainSupportsTools(tier)) {
      const { static: contextStatic, dynamic: context } = promptFor("tools");
      try {
        const result = await runMiloAgent({
          message,
          contextStatic,
          context,
          history,
          isPro,
          tools: createToolContext(userId, getTodayInTimeZone(timeZone), now, message)
        });
        text = result.text;
        taskActions = result.taskActions;
        proposal = result.proposal;
        factsSaved = result.factsSaved;
        factProposals = result.factProposals;
        viaTools = true;
        console.info(
          `[milo] user=${userId} tools=[${result.toolsUsed.join(", ")}] rounds=${result.rounds} via=${result.provider}`
        );
      } catch (error) {
        if (!toolsNotSupported(error)) throw error;
        console.warn(`[milo] user=${userId} tools rejected by every provider, using the TASKS_ACTION fallback`);
      }
    }

    if (!viaTools) {
      const { static: contextStatic, dynamic: context } = promptFor(canCreateTasks ? "legacy" : "tools");
      const { content } = await chatWithMilo({ message, contextStatic, context, history, isPro });
      const parsed = parseTaskActions(content, now);

      // This used to swallow every malformed block, so "Milo no me creo las
      // tareas" had no explanation anywhere. Now the reason is in the logs.
      if (parsed.error) {
        console.error(`[milo] user=${userId} task block present but unusable: ${parsed.error}`);
      } else if (parsed.partial) {
        console.warn(`[milo] user=${userId} reply was truncated, recovered ${parsed.taskActions.length} task(s)`);
      }
      text = parsed.text;
      taskActions = parsed.taskActions;
    }

    // This used to be a bare `void`, which runs in development and dies
    // silently in production: once the response is sent, Vercel freezes the
    // function and anything still pending is killed mid-flight. No error, no
    // log line — the memory summary just quietly stops updating, and Milo
    // forgets the context that makes it useful. `after()` is the platform's
    // guarantee that the work runs to completion after the response is out.
    after(() =>
      updateMemoryInBackground(userId, userMemory, [
        ...history,
        { role: "user", content: message },
        { role: "assistant", content: text }
      ])
    );

    return NextResponse.json({
      response: text,
      taskActions: canCreateTasks && taskActions.length > 0 ? taskActions : null,
      proposal: canCreateTasks ? proposal : null,
      // Lo que Milo guardó (lo dijo el usuario) y lo que propone guardar (espera confirmación).
      factsSaved: canCreateTasks ? factsSaved : [],
      factProposals: canCreateTasks ? factProposals : []
    });
  } catch (error) {
    // Groq's plan allows 200k tokens per day for the whole account, so a budget
    // overrun is a normal operating condition rather than a bug — and the chain
    // exists precisely so it is no longer the only outcome. It becomes a
    // user-facing state only when the second provider is unavailable too.
    const failure = classifyChatFailure(error);

    console.error(
      `[milo] user=${userId} chat failed: kinds=[${failure.kinds.join(", ")}] busy=${failure.busy} timedOut=${failure.timedOut}`,
      error
    );

    if (failure.busy) {
      return NextResponse.json(
        { error: "Milo está con muchos mensajes ahora. Probá en un rato." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: failure.timedOut
          ? "Milo tardó demasiado en responder."
          : "No se pudo conectar con Milo."
      },
      { status: 502 }
    );
  }
}

async function updateMemoryInBackground(
  userId: string,
  previousSummary: string,
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>
) {
  try {
    const { count } = await bumpMessageCount(userId);
    if (!shouldRefreshMemory(count)) return;

    const updatedSummary = await refreshUserMemorySummary({
      previousSummary,
      history: recentHistory.slice(-20)
    });
    await saveUserMemory(userId, updatedSummary);
  } catch (error) {
    console.error("Failed to update user memory", error);
  }
}
