import "server-only";
import sql from "@/lib/db";
import { toSubscriptionStatus } from "@/lib/paddle";
import type { StoredPaddleState, SubscriptionSnapshot } from "@/lib/paddle-subscription";
import type { PaidPlanName } from "@/lib/subscription-plans";

// The webhook's only write path into user_plans. Server credentials only: this
// module is imported by the webhook route and nothing a browser can reach.

export async function findOwner(subscriptionId: string, customerId: string): Promise<string | null> {
  // mp_preapproval_id holds the provider's subscription id too (see
  // resolveTrialView), so rows written before the Paddle columns still match.
  const bySubscription = await sql`
    SELECT user_id FROM user_plans
    WHERE paddle_subscription_id = ${subscriptionId} OR mp_preapproval_id = ${subscriptionId}
    LIMIT 1
  `;
  if (bySubscription[0]) return bySubscription[0].user_id as string;

  const byCustomer = await sql`
    SELECT user_id FROM user_plans WHERE paddle_customer_id = ${customerId} LIMIT 1
  `;
  return (byCustomer[0]?.user_id as string | undefined) ?? null;
}

export async function getStored(userId: string): Promise<StoredPaddleState | null> {
  const rows = await sql`
    SELECT paddle_subscription_id, paddle_status, current_period_end, paddle_event_at
    FROM user_plans WHERE user_id = ${userId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    paddleSubscriptionId: (row.paddle_subscription_id as string | null) ?? null,
    paddleStatus: (row.paddle_status as string | null) ?? null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end as string) : null,
    eventAt: row.paddle_event_at ? new Date(row.paddle_event_at as string) : null
  };
}

/**
 * Upsert keyed on user_id. The WHERE on the conflict branch is the ordering
 * guard: for the SAME subscription an older `occurred_at` never overwrites a
 * newer one, atomically, even if two deliveries race. Returns false when it
 * refused the write.
 */
export async function saveSubscription(
  userId: string,
  snapshot: SubscriptionSnapshot,
  plan: PaidPlanName | "free"
): Promise<boolean> {
  const legacyStatus = toSubscriptionStatus(snapshot.status);
  const rows = await sql`
    INSERT INTO user_plans (
      user_id, plan, mp_preapproval_id, subscription_status, trial_ends_at,
      paddle_customer_id, paddle_subscription_id, paddle_status, paddle_price_id,
      current_period_end, cancel_at_period_end, paddle_event_at, updated_at
    )
    VALUES (
      ${userId}, ${plan}, ${snapshot.subscriptionId}, ${legacyStatus}, NULL,
      ${snapshot.customerId}, ${snapshot.subscriptionId}, ${snapshot.status}, ${snapshot.priceIds[0] ?? null},
      ${snapshot.currentPeriodEnd?.toISOString() ?? null}, ${snapshot.cancelAtPeriodEnd},
      ${snapshot.eventAt.toISOString()}, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      mp_preapproval_id = EXCLUDED.mp_preapproval_id,
      subscription_status = EXCLUDED.subscription_status,
      trial_ends_at = NULL,
      paddle_customer_id = EXCLUDED.paddle_customer_id,
      paddle_subscription_id = EXCLUDED.paddle_subscription_id,
      paddle_status = EXCLUDED.paddle_status,
      paddle_price_id = EXCLUDED.paddle_price_id,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      paddle_event_at = EXCLUDED.paddle_event_at,
      updated_at = NOW()
    WHERE user_plans.paddle_subscription_id IS DISTINCT FROM EXCLUDED.paddle_subscription_id
       OR user_plans.paddle_event_at IS NULL
       OR user_plans.paddle_event_at <= EXCLUDED.paddle_event_at
    RETURNING user_id
  `;
  return rows.length > 0;
}
