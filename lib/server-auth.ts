import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import sql from "@/lib/db";
import {
  resolvePlanForStatus,
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
    const rows = await sql`
      SELECT plan, trial_ends_at, subscription_status
      FROM user_plans WHERE user_id = ${userId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return "free";

    // A live Mercado Pago subscription is authoritative: the trial countdown
    // must not demote someone who is actually paying.
    if (row.subscription_status === "authorized" || row.subscription_status === "paused") {
      return row.plan === "pro" ? "pro" : "plus";
    }

    if (row.plan === "plus" && row.trial_ends_at && new Date(row.trial_ends_at) < new Date()) {
      return "free";
    }

    return row.plan === "pro" ? "pro" : row.plan === "plus" ? "plus" : "free";
  } catch (error) {
    // Degrade to free rather than break every AI route, but never silently:
    // this is how a paying customer quietly loses their plan during a DB blip.
    console.error(`getUserPlan failed for ${userId}; falling back to free`, error);
    return "free";
  }
}

export async function getUserPlanRow(userId: string) {
  const rows = await sql`
    SELECT plan, trial_ends_at, mp_preapproval_id, subscription_status
    FROM user_plans WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0] ?? null;
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

/**
 * Finds the account behind a subscription id the webhook did not carry a
 * user_id for. Paddle normally echoes the checkout's `customData.user_id`, so
 * this is the fallback for renewals and for any event that arrives without the
 * custom field — Mercado Pago, where the id was the only handle, worked this
 * way and the column it used is still what stores it.
 */
export async function findUserIdByPreapprovalId(mpPreapprovalId: string): Promise<string | null> {
  const rows = await sql`
    SELECT user_id FROM user_plans WHERE mp_preapproval_id = ${mpPreapprovalId} LIMIT 1
  `;
  return (rows[0]?.user_id as string | undefined) ?? null;
}

/**
 * Authoritative subscription sync, driven by the webhook. Idempotent and keyed
 * on user_id so retries and out-of-order events converge on the same state.
 *
 * `mpPreapprovalId` / `mp_preapproval_id` hold whichever provider issued the
 * subscription — Mercado Pago's preapproval id or Paddle's subscription
 * id. The column keeps its original name so no migration stands between an
 * already-written row and a working lookup; `resolveTrialView` and
 * `findUserIdByPreapprovalId` only ever treat it as "there is a real
 * subscription behind this account".
 */
export async function syncSubscription(params: {
  userId: string;
  plan: "plus" | "pro";
  mpPreapprovalId: string;
  payerEmail: string;
  status: SubscriptionStatus;
}): Promise<void> {
  const plan = resolvePlanForStatus(params.plan, params.status);
  await sql`
    INSERT INTO user_plans (
      user_id, plan, mp_preapproval_id, mp_payer_email, subscription_status, trial_ends_at, updated_at
    )
    VALUES (
      ${params.userId}, ${plan}, ${params.mpPreapprovalId}, ${params.payerEmail}, ${params.status}, NULL, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      plan = ${plan},
      mp_preapproval_id = ${params.mpPreapprovalId},
      -- Paddle's payload carries a customer id, not an email, so the
      -- webhook passes an empty string. Without this guard every renewal would
      -- erase the address a Mercado Pago subscriber still has on file.
      mp_payer_email = CASE
        WHEN ${params.payerEmail} = '' THEN user_plans.mp_payer_email
        ELSE ${params.payerEmail}
      END,
      subscription_status = ${params.status},
      trial_ends_at = NULL,
      updated_at = NOW()
  `;
}
