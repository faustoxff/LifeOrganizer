import "server-only";
import { NextResponse } from "next/server";
import { buildContextSummary, TOTAL_BUDGET } from "@/lib/context-summary";
import { extractFileText, FileError, MAX_FILE_BYTES, MAX_FILES } from "@/lib/file-text";
import { getPromptLanguageName, supportedLanguages, type AppLanguage } from "@/lib/i18n";
import { summarizeText } from "@/lib/project-ai";
import { aiFailureResponse, authenticate, isPaid, planRequired } from "@/lib/project-route";
import { getUserPlan } from "@/lib/server-auth";
import { consumeDailyUsage, dailyLimitResponse } from "@/lib/usage-limits";

// Reading a PDF and summarising a long one can take a while.
export const maxDuration = 60;

/** El cupo diario de IA se agotó a mitad del resumen. */
class DailyLimitError extends Error {
  constructor(readonly limit: number) {
    super("DAILY_LIMIT");
  }
}

const FILE_ERROR_STATUS: Record<string, number> = {
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  IMAGES_UNSUPPORTED: 415,
  EMPTY: 422,
  UNREADABLE: 422
};

// POST /api/projects/extract — multipart, ONE file per request (Vercel rejects any
// request over 4.5 MB, so three files in one body would not fit). The file is read in
// memory, its text is extracted and summarised, and the file is discarded: nothing but
// the summary is ever kept.
export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { userId } = auth;

  const plan = await getUserPlan(userId);
  if (!isPaid(plan)) return planRequired();

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "The file is too large", code: "TOO_LARGE" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const language = form.get("uiLanguage");
  const languageName = getPromptLanguageName(
    supportedLanguages.includes(language as AppLanguage) ? (language as AppLanguage) : "en"
  );
  // How many files the client will send in total: this one gets its share of the budget.
  const total = Math.min(MAX_FILES, Math.max(1, Number(form.get("of")) || 1));

  try {
    const extracted = await extractFileText({
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer())
    });

    // The AI is only called for a long text, and only then does the daily counter move.
    let charged = false;
    const summary = await buildContextSummary(
      [{ name: extracted.name, text: extracted.text }],
      async (text, maxChars, hint) => {
        if (!charged) {
          const usage = await consumeDailyUsage(userId, "project_intake", plan);
          if (!usage.allowed) throw new DailyLimitError(usage.limit);
          charged = true;
        }
        return summarizeText(userId, text, maxChars, hint, languageName);
      },
      Math.floor(TOTAL_BUDGET / total)
    );

    return NextResponse.json({
      name: extracted.name,
      kind: extracted.kind,
      chars: extracted.text.length,
      truncated: extracted.truncated,
      summary
    });
  } catch (error) {
    if (error instanceof DailyLimitError) return dailyLimitResponse(error.limit, plan);
    if (error instanceof FileError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: FILE_ERROR_STATUS[error.code] ?? 422 }
      );
    }
    return aiFailureResponse(error);
  }
}
