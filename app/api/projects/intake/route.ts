import "server-only";
import { NextResponse } from "next/server";
import { getPromptLanguageName, supportedLanguages, type AppLanguage } from "@/lib/i18n";
import { runIntake } from "@/lib/project-ai";
import { parseProjectBasics } from "@/lib/project-input";
import { aiFailureResponse, authenticate, badRequest, gateAi, readBody, todayFor } from "@/lib/project-route";
import { getAvailabilitySettings } from "@/lib/user-settings";

export const maxDuration = 60;

// POST /api/projects/intake — the AI says what it understood and asks only what would
// change the plan. { title, description, deadline, contextSummary?, uiLanguage?, tz? }
export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const body = await readBody(request);
  if (!body) return badRequest("Invalid request");

  const today = await todayFor(userId, body.tz);
  const basics = parseProjectBasics(body, today);
  if (!basics.ok) return badRequest(basics.error);

  const blocked = await gateAi(userId, "project_intake");
  if (blocked) return blocked;

  const language = supportedLanguages.includes(body.uiLanguage as AppLanguage) ? (body.uiLanguage as AppLanguage) : "en";
  const { availability, overrides } = await getAvailabilitySettings(userId);

  try {
    const intake = await runIntake(userId, {
      ...basics.value,
      today,
      availability,
      overrides,
      language: getPromptLanguageName(language)
    });
    return NextResponse.json(intake);
  } catch (error) {
    return aiFailureResponse(error);
  }
}
