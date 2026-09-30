import "server-only";
import { NextResponse } from "next/server";
import { AppLanguage, supportedLanguages } from "@/lib/i18n";
import { chatWithMilo, parseJsonObject } from "@/lib/milo";
import { requireAuth, getUserPlan } from "@/lib/server-auth";
import { clampEstimate } from "@/lib/task-estimate";
import { consumeDailyUsage } from "@/lib/usage-limits";

const MAX_FIELD = 500;
const MAX_STEPS = 8;

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English", es: "neutral Spanish (use tú, never voseo)", pt: "Brazilian Portuguese", fr: "French", de: "German",
  it: "Italian", zh: "Simplified Chinese", ja: "Japanese", ko: "Korean", ru: "Russian",
  tr: "Turkish", nl: "Dutch", pl: "Polish"
};

type Body = {
  task?: { title?: unknown; description?: unknown; category?: unknown; estimateMin?: unknown };
  uiLanguage?: unknown;
};

export async function POST(request: Request) {
  let userId: string;
  try { userId = await requireAuth(); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

  const body = (await request.json().catch(() => ({}))) as Body;
  const title = typeof body.task?.title === "string" ? body.task.title.trim().slice(0, MAX_FIELD) : "";
  const description = typeof body.task?.description === "string" ? body.task.description.trim().slice(0, MAX_FIELD) : "";
  const category = typeof body.task?.category === "string" ? body.task.category.trim().slice(0, 60) : "";
  const estimatedMinutes = clampEstimate(body.task?.estimateMin);
  const language: AppLanguage = supportedLanguages.includes(body.uiLanguage as AppLanguage)
    ? (body.uiLanguage as AppLanguage)
    : "en";

  if (!title) return NextResponse.json({ error: "Missing task" }, { status: 400 });

  const plan = await getUserPlan(userId);
  const usage = await consumeDailyUsage(userId, "ai_task_steps", plan);
  if (!usage.allowed) {
    return NextResponse.json({ error: "DAILY_LIMIT_REACHED", limit: usage.limit }, { status: 429 });
  }

  const context = `You break tasks down for people who get stuck starting them (ADHD, executive dysfunction).
Return ONLY a JSON object, nothing else: {"steps":["...","..."]}
Rules:
- Between 3 and ${MAX_STEPS} steps, in order.
- Each step is ONE concrete physical action someone could film, max 12 words.
- Write every step as a direct command to the reader (imperative), never as an infinitive, and keep that form for all of them.
- The FIRST step must take under 2 minutes, so starting feels effortless.
- Never use vague verbs like plan, organize, think, understand, decide, prepare or review on their own.
- No numbering, no emojis, no explanations, no sub-steps.
- Write every step in ${LANGUAGE_NAMES[language]}, with correct grammar and gender agreement.`;

  try {
    const { content } = await chatWithMilo({
      message: JSON.stringify({ title, description, category, estimatedMinutes }),
      context,
      // Splitting a task into steps is mechanical once the task is read.
      tier: "fast",
      timeoutMs: 20000,
      maxTokens: 400
    });
    const parsed = parseJsonObject<{ steps?: unknown }>(content);
    const steps = Array.isArray(parsed?.steps)
      ? parsed.steps
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 200))
          .slice(0, MAX_STEPS)
      : [];
    if (steps.length < 2) {
      return NextResponse.json({ error: "NO_STEPS" }, { status: 502 });
    }
    return NextResponse.json({ steps });
  } catch (error) {
    console.error("ai-task-steps failed", error);
    return NextResponse.json({ error: "AI_UNAVAILABLE" }, { status: 502 });
  }
}
