import "server-only";
import { NextResponse } from "next/server";
import { classifyChatFailure } from "@/lib/milo";
import { ProjectAiError } from "@/lib/project-ai";
import { getUserPlan, requireAuth, type UserPlan } from "@/lib/server-auth";
import { getTodayInTimeZone } from "@/lib/task-date";
import { consumeDailyUsage, dailyLimitResponse, type UsageKind } from "@/lib/usage-limits";
import { resolveUserTimeZone } from "@/lib/user-settings";

/** Piezas comunes de las rutas de proyectos. */

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** Crear un proyecto y todo lo que usa IA es Plus/Pro. */
export const planRequired = () =>
  NextResponse.json({ error: "Projects are available on Plus and Pro", code: "PLAN_REQUIRED" }, { status: 403 });

export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function authenticate(): Promise<{ userId: string } | { response: NextResponse }> {
  try {
    return { userId: await requireAuth() };
  } catch {
    return { response: unauthorized() };
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** "Hoy" del usuario (con la zona que reporta el navegador, si la manda). */
export async function todayFor(userId: string, reportedTimeZone?: unknown): Promise<string> {
  return getTodayInTimeZone(await resolveUserTimeZone(userId, reportedTimeZone));
}

export const isPaid = (plan: UserPlan) => plan !== "free";

/**
 * Plan pago + cupo diario, en ese orden: un Free nunca gasta un contador. Devuelve la
 * respuesta a enviar si no se puede seguir, o null si sí.
 */
export async function gateAi(userId: string, kind: UsageKind): Promise<NextResponse | null> {
  const plan = await getUserPlan(userId);
  if (!isPaid(plan)) return planRequired();
  const usage = await consumeDailyUsage(userId, kind, plan);
  return usage.allowed ? null : dailyLimitResponse(usage.limit, plan);
}

/** Una llamada de IA que falló: distingue "no entendió", "está ocupada" y "se rompió". */
export function aiFailureResponse(error: unknown): NextResponse {
  if (error instanceof ProjectAiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 502 });
  }
  const failure = classifyChatFailure(error);
  console.error("[projects] AI call failed", error);
  if (failure.busy) {
    return NextResponse.json({ error: "La IA está con mucha demanda ahora. Probá en un rato.", code: "AI_BUSY" }, { status: 503 });
  }
  return NextResponse.json(
    { error: failure.timedOut ? "La IA tardó demasiado en responder." : "No se pudo conectar con la IA.", code: "AI_UNAVAILABLE" },
    { status: 502 }
  );
}
