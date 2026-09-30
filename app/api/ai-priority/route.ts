import { NextResponse } from "next/server";
import {
  buildAiPriorityInstructions,
  buildAiPriorityRepairInstructions
} from "@/lib/ai-priority-config";
import { AppLanguage } from "@/lib/i18n";
import { requireAuth, getUserPlan } from "@/lib/server-auth";
import { consumeDailyUsage } from "@/lib/usage-limits";

const MAX_TASKS = 100;
import {
  chatWithMilo,
  getMiloErrorMessage,
  parseJsonObject
} from "@/lib/milo";
import { getDaysUntilDueDate } from "@/lib/task-date";
import { getUserToday } from "@/lib/user-settings";
import { getTaskScore } from "@/lib/task-score";
import {
  AiPriorityApiResponse,
  AiPriorityRecommendation,
  AiPriorityTaskInput
} from "@/types/ai-priority";
import { Task } from "@/types/task";

type AiPriorityRequestTask = Pick<
  Task,
  "id" | "title" | "category" | "description" | "priority" | "estimateMin" | "dueDate"
>;

const AI_CACHE_TTL_MS = 5 * 60 * 1000;
const AI_PRIORITY_CACHE_VERSION = 3;

const aiRecommendationCache = new Map<
  string,
  {
    expiresAt: number;
    recommendation: AiPriorityRecommendation;
  }
>();

export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireAuth(); }
  catch {
    return NextResponse.json<AiPriorityApiResponse>(
      { enabled: true, recommendation: null, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const plan = await getUserPlan(userId);

  if (plan === "free") {
    return NextResponse.json<AiPriorityApiResponse>({
      enabled: false,
      recommendation: null,
      error: null
    });
  }

  const body = (await request.json()) as {
    tasks?: AiPriorityRequestTask[];
    uiLanguage?: AppLanguage;
  };
  const pendingTasks = Array.isArray(body.tasks) ? body.tasks.slice(0, MAX_TASKS) : [];
  const uiLanguage = body.uiLanguage === "es" ? "es" : "en";

  if (pendingTasks.length === 0) {
    return NextResponse.json<AiPriorityApiResponse>({
      enabled: true,
      recommendation: null,
      error: null
    });
  }

  // "Today" is the user's, not the server's: on UTC the day is wrong for hours
  // every evening for anyone west of it, which shifted every dueInDays.
  const today = await getUserToday(userId);
  const taskInputs: AiPriorityTaskInput[] = pendingTasks.map((task) => ({
    id: task.id,
    title: task.title,
    category: task.category,
    description: task.description,
    priority: task.priority,
    estimateMin: task.estimateMin,
    dueDate: task.dueDate,
    dueInDays: getDaysUntilDueDate(task.dueDate, today),
    systemScore: getTaskScore(task, today)
  }));

  // The quota is charged here, not at the top of the handler.
  //
  // This endpoint fires on page mount and again on every task edit, while the
  // 5-minute cache answers almost all of those without touching a model. When
  // the counter ran first, a Plus user with 40 recommendations a day could
  // spend the whole allowance on cache hits — zero provider cost to us, a 429
  // to them — and the empty-task early return above was charged the same way
  // for doing no work at all. Now a quota only moves when a model is asked.
  const cacheKey = buildRecommendationCacheKey(userId, uiLanguage, taskInputs);
  const cachedRecommendation = getCachedRecommendation(cacheKey);
  if (cachedRecommendation) {
    return NextResponse.json<AiPriorityApiResponse>({
      enabled: true,
      recommendation: cachedRecommendation,
      error: null
    });
  }

  const usage = await consumeDailyUsage(userId, "ai_priority", plan);
  if (!usage.allowed) {
    return NextResponse.json<AiPriorityApiResponse>(
      { enabled: true, recommendation: null, error: "Llegaste al límite diario de recomendaciones de IA. Se reinicia mañana." },
      { status: 429 }
    );
  }

  try {
    const recommendation = await requestMiloRecommendation(
      userId,
      taskInputs,
      pendingTasks,
      uiLanguage
    );

    return NextResponse.json<AiPriorityApiResponse>({
      enabled: true,
      recommendation,
      error: null
    });
  } catch (error) {
    console.error("AI priority request failed", error);

    return NextResponse.json<AiPriorityApiResponse>(
      {
        enabled: true,
        recommendation: null,
        error: getMiloErrorMessage(
          error,
          uiLanguage === "es" ? "la recomendacion de prioridad" : "the priority recommendation",
          uiLanguage
        )
      },
      { status: 502 }
    );
  }
}

async function requestMiloRecommendation(
  userId: string,
  taskInputs: AiPriorityTaskInput[],
  tasks: AiPriorityRequestTask[],
  language: AppLanguage
) {
  const cacheKey = buildRecommendationCacheKey(userId, language, taskInputs);
  const cachedRecommendation = getCachedRecommendation(cacheKey);

  if (cachedRecommendation) {
    return cachedRecommendation;
  }

  const isSingleTask = taskInputs.length === 1;
  const validTaskIds = taskInputs.map((taskInput) => taskInput.id);
  const requestPayload = isSingleTask
    ? {
        recommendedTaskId: taskInputs[0].id,
        allowedTaskIds: validTaskIds,
        task: taskInputs[0]
      }
    : {
        allowedTaskIds: validTaskIds,
        tasks: taskInputs
      };

  const { content, model } = await chatWithMilo({
    message: JSON.stringify(requestPayload),
    context: buildAiPriorityInstructions(taskInputs.length, language, validTaskIds)
  });

  const validRecommendation = await parseAndValidateRecommendation({
    content,
    language,
    model,
    requestPayload,
    taskInputs,
    tasks,
    validTaskIds
  });

  if (!validRecommendation) {
    throw new Error(
      language === "es"
        ? "Milo respondió, pero no devolvió una recomendación válida."
        : "Milo responded, but it did not return a valid recommendation."
    );
  }

  const recommendation = {
    ...validRecommendation,
    model
  };

  setCachedRecommendation(cacheKey, recommendation);

  return recommendation;
}

async function parseAndValidateRecommendation(input: {
  content: string;
  language: AppLanguage;
  model: string;
  requestPayload: object;
  taskInputs: AiPriorityTaskInput[];
  tasks: AiPriorityRequestTask[];
  validTaskIds: string[];
}) {
  const firstPassRecommendation = validateRecommendation(
    parseJsonObject<Omit<AiPriorityRecommendation, "model">>(input.content),
    input.tasks
  );

  if (firstPassRecommendation) {
    return firstPassRecommendation;
  }

  console.warn("Invalid AI priority response received from Milo", {
    model: input.model,
    content: input.content
  });

  const { content: repairedContent } = await chatWithMilo({
    message: JSON.stringify({
      tasks: input.taskInputs,
      originalRequest: input.requestPayload,
      originalModelOutput: input.content
    }),
    context: buildAiPriorityRepairInstructions(input.language, input.validTaskIds)
  });

  return validateRecommendation(
    parseJsonObject<Omit<AiPriorityRecommendation, "model">>(repairedContent),
    input.tasks
  );
}

function validateRecommendation(
  value: Omit<AiPriorityRecommendation, "model"> | null,
  tasks: AiPriorityRequestTask[]
): Omit<AiPriorityRecommendation, "model"> | null {
  if (!value) {
    return null;
  }

  const validTaskIds = new Set(tasks.map((task) => task.id));
  const recommendationReason =
    typeof value.recommendationReason === "string"
      ? value.recommendationReason.replace(/\s+/g, " ").trim()
      : "";

  if (
    typeof value.recommendedTaskId !== "string" ||
    !validTaskIds.has(value.recommendedTaskId) ||
    recommendationReason.length < 12
  ) {
    return null;
  }

  return {
    recommendedTaskId: value.recommendedTaskId,
    recommendationReason
  };
}

function buildRecommendationCacheKey(
  userId: string,
  language: AppLanguage,
  taskInputs: AiPriorityTaskInput[]
) {
  // The cache lives in the server process and is shared by everyone, so the
  // user is part of the key: no entry can ever be served to another account.
  return JSON.stringify({
    version: AI_PRIORITY_CACHE_VERSION,
    userId,
    language,
    taskInputs
  });
}

function getCachedRecommendation(cacheKey: string) {
  const cachedEntry = aiRecommendationCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    aiRecommendationCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.recommendation;
}

function setCachedRecommendation(
  cacheKey: string,
  recommendation: AiPriorityRecommendation
) {
  aiRecommendationCache.set(cacheKey, {
    expiresAt: Date.now() + AI_CACHE_TTL_MS,
    recommendation
  });
}

