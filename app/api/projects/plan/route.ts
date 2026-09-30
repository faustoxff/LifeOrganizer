import "server-only";
import { NextResponse } from "next/server";
import { getPromptLanguageName, supportedLanguages, type AppLanguage } from "@/lib/i18n";
import { runPlan } from "@/lib/project-ai";
import { parseAnswers, parseProjectBasics, parseUnderstanding } from "@/lib/project-input";
import { aiFailureResponse, authenticate, badRequest, gateAi, readBody, todayFor } from "@/lib/project-route";
import { previewDraft } from "@/lib/projects-service";
import { getAvailabilitySettings } from "@/lib/user-settings";

// Splitting a big project is the heaviest call in the product: a large prompt on the
// planner tier, and a second attempt when the first answer is not valid.
export const maxDuration = 60;

// POST /api/projects/plan — the AI proposes subtasks (what and how long, never when);
// the scheduler decides when, with the user's own learned inflation factor.
// { title, description, deadline, contextSummary?, understanding?, answers?, uiLanguage?, tz? }
export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const body = await readBody(request);
  if (!body) return badRequest("Invalid request");

  const today = await todayFor(userId, body.tz);
  const basics = parseProjectBasics(body, today);
  if (!basics.ok) return badRequest(basics.error);

  const blocked = await gateAi(userId, "project_plan");
  if (blocked) return blocked;

  const language = supportedLanguages.includes(body.uiLanguage as AppLanguage) ? (body.uiLanguage as AppLanguage) : "en";
  const { availability, overrides } = await getAvailabilitySettings(userId);

  try {
    const { subtasks, warnings } = await runPlan(userId, {
      ...basics.value,
      today,
      availability,
      overrides,
      language: getPromptLanguageName(language),
      understanding: parseUnderstanding(body.understanding),
      answers: parseAnswers(body.answers)
    });
    const draft = await previewDraft(userId, today, {
      deadline: basics.value.deadline,
      dailyCapMin: null,
      subtasks,
      extraMinPerDay: 0
    });
    return NextResponse.json({ ...draft, aiWarnings: warnings });
  } catch (error) {
    return aiFailureResponse(error);
  }
}
