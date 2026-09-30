import "server-only";
import { NextResponse } from "next/server";
import sql from "@/lib/db";
import type { UserPlan } from "@/lib/server-auth";

export type UsageKind =
  | "milo_chat"
  | "ai_priority"
  | "ai_task_help"
  | "ai_task_steps"
  | "milo_companion"
  | "stats_blurb"
  | "transcribe"
  | "project_intake"
  | "project_plan";

// Max AI calls per user per day (UTC), by plan. Tune these as costs become clear.
export const DAILY_LIMITS: Record<UsageKind, Record<UserPlan, number>> = {
  milo_chat: { free: 15, plus: 60, pro: 200 },
  ai_priority: { free: 0, plus: 40, pro: 100 },
  ai_task_help: { free: 0, plus: 0, pro: 60 },
  ai_task_steps: { free: 5, plus: 30, pro: 100 },
  // Body doubling: ~3 check-ins per focus session, Pro only.
  milo_companion: { free: 0, plus: 0, pro: 60 },
  // The one-line blurb over the stats. Decorative and Pro-only, but it was
  // the only AI call in the app with no counter at all — a session could
  // refresh the page in a loop and spend tokens nobody was accounting for.
  stats_blurb: { free: 0, plus: 0, pro: 60 },
  // Voice dictation: each use is one short audio clip.
  transcribe: { free: 20, plus: 100, pro: 300 },
  // Projects are Plus/Pro. Intake is a short call (and file summaries share its
  // budget); a plan is the expensive one — a large prompt on the `planner` tier,
  // possibly twice when the first answer is invalid — so it gets the tighter number.
  project_intake: { free: 0, plus: 15, pro: 40 },
  project_plan: { free: 0, plus: 6, pro: 20 }
};

// Hard cap on stored tasks for any plan (free is further limited in the tasks route).
export const MAX_TASKS_PER_USER = 1000;

/**
 * Backstop used only when the database counter is unreachable. Without it, a
 * Neon outage would not merely disable the limit — it would remove it, and the
 * Groq/Tavily bill would be unbounded. Counts stay in process memory and expire
 * with the UTC day, so a user can overspend at most their own plan limit per
 * instance while the counter is down.
 */
const offlineCounts = new Map<string, number>();
const OFFLINE_MAP_CAP = 10_000;

function offlineKey(userId: string, kind: UsageKind): string {
  return `${userId}:${kind}:${new Date().toISOString().slice(0, 10)}`;
}

function consumeOffline(userId: string, kind: UsageKind, limit: number): boolean {
  if (offlineCounts.size > OFFLINE_MAP_CAP) offlineCounts.clear();
  const key = offlineKey(userId, kind);
  const count = (offlineCounts.get(key) ?? 0) + 1;
  offlineCounts.set(key, count);
  return count <= limit;
}

/**
 * Atomically counts one use for today and reports whether the user is still within the limit.
 * Fails open on DB errors so an outage in the counter does not take the whole feature down,
 * but the in-memory backstop above still caps how far "open" goes.
 */
export async function consumeDailyUsage(
  userId: string,
  kind: UsageKind,
  plan: UserPlan
): Promise<{ allowed: boolean; limit: number }> {
  const limit = DAILY_LIMITS[kind][plan];
  if (limit <= 0) return { allowed: false, limit };

  try {
    const rows = await sql`
      INSERT INTO ai_usage (user_id, day, kind, count)
      VALUES (${userId}, CURRENT_DATE, ${kind}, 1)
      ON CONFLICT (user_id, day, kind) DO UPDATE SET count = ai_usage.count + 1
      RETURNING count
    `;
    return { allowed: (rows[0].count as number) <= limit, limit };
  } catch (error) {
    const allowed = consumeOffline(userId, kind, limit);
    console.error(
      `consumeDailyUsage counter unavailable for ${kind} (${userId}); offline backstop ` +
        `${offlineCounts.get(offlineKey(userId, kind))}/${limit} -> ${allowed ? "allowed" : "blocked"}`,
      error
    );
    return { allowed, limit };
  }
}

export function dailyLimitResponse(limit: number, plan: UserPlan) {
  const upsell = plan === "pro" ? "" : " Puedes subir de plan en /plans para tener más.";
  return NextResponse.json(
    {
      error: `Llegaste al límite diario de ${limit} mensajes.${upsell} Se reinicia mañana.`,
      code: "DAILY_LIMIT_REACHED",
      limit
    },
    { status: 429 }
  );
}
