import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import sql from "@/lib/db";
import {
  resolveUserPlan,
  type PlanRow,
  type SubscriptionStatus,
  type UserPlan
} from "@/lib/subscription-plans";

export async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

export async function requireAuthWithEmail(): Promise<{ userId: string; email: string }> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
    ?? user.emailAddresses[0]?.emailAddress
    ?? "";
  return { userId: user.id, email };
}

export type { SubscriptionStatus, UserPlan } from "@/lib/subscription-plans";

export async function getUserPlan(userId: string): Promise<UserPlan> {
  try {
    const row = await getUserPlanRow(userId);
    return resolveUserPlan(row ? planRowFrom(row) : null, new Date());
  } catch (error) {
    // Degrade to free rather than break every AI route, but never silently:
    // this is how a paying customer quietly loses their plan during a DB blip.
    console.error(`getUserPlan failed for ${userId}; falling back to free`, error);
    return "free";
  }
}

export async function getUserPlanRow(userId: string) {
  const rows = await sql`
    SELECT plan, trial_ends_at, mp_preapproval_id, subscription_status,
           paddle_customer_id, paddle_subscription_id, paddle_status,
           current_period_end, cancel_at_period_end
    FROM user_plans WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Maps a `getUserPlanRow` result onto the pure `PlanRow` that `resolveUserPlan` reads. */
export function planRowFrom(row: Record<string, unknown>): PlanRow {
  return {
    plan: (row.plan as string | null) ?? null,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at as string) : null,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus | null) ?? null,
    paddleStatus: (row.paddle_status as string | null) ?? null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end as string) : null
  };
}

export async function startPlusTrial(userId: string, trialDays: number): Promise<Date | null> {
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
  // Only users who never had a trial or a subscription can start one.
  const rows = await sql`
    INSERT INTO user_plans (user_id, plan, trial_ends_at, updated_at)
    VALUES (${userId}, 'plus', ${trialEndsAt.toISOString()}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      plan = 'plus',
      trial_ends_at = ${trialEndsAt.toISOString()},
      updated_at = NOW()
    WHERE user_plans.plan = 'free'
      AND user_plans.trial_ends_at IS NULL
      AND user_plans.mp_preapproval_id IS NULL
    RETURNING user_id
  `;
  return rows.length > 0 ? trialEndsAt : null;
}
