import "server-only";
import { NextResponse } from "next/server";
import type { ChecklistContext } from "@/lib/checklists-service";
import { resolveAppLanguage, type AppLanguage } from "@/lib/i18n";
import { getUserPlan, requireAuth, type UserPlan } from "@/lib/server-auth";
import { getTodayInTimeZone } from "@/lib/task-date";
import { resolveUserTimeZone } from "@/lib/user-settings";

/** Piezas comunes de las rutas de checklists, hechos y ubicación. */

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
export const planRequired = () =>
  NextResponse.json({ error: "Checklists are available on Plus and Pro", code: "PLAN_REQUIRED" }, { status: 403 });
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

/** Autenticado y con plan pago. Las checklists son Plus/Pro. */
export async function authenticatePaid(): Promise<{ userId: string; plan: UserPlan } | { response: NextResponse }> {
  const auth = await authenticate();
  if ("response" in auth) return auth;
  const plan = await getUserPlan(auth.userId);
  if (plan === "free") return { response: planRequired() };
  return { userId: auth.userId, plan };
}

export async function checklistContext(userId: string, uiLanguage: unknown): Promise<ChecklistContext> {
  const timeZone = await resolveUserTimeZone(userId);
  const language: AppLanguage = resolveAppLanguage(typeof uiLanguage === "string" ? uiLanguage : null);
  return { userId, timeZone, today: getTodayInTimeZone(timeZone), language };
}
