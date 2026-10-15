// Pure plan/subscription mapping. Kept free of `server-only` and database code
// so it can be unit tested and reused from anywhere.

export type PaidPlanName = "plus" | "pro";
export type UserPlan = "free" | PaidPlanName;
export type SubscriptionStatus = "authorized" | "paused" | "cancelled";
/** A subscription's status exactly as Paddle reports it. */
export type PaddleStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";

/**
 * Whether a Paddle subscription currently grants the paid plan.
 *
 * `active` and `trialing` always do. `past_due` means a renewal charge failed
 * and Paddle is retrying the card: the customer keeps the plan only while the
 * period they already paid for has not ended, so a card that never recovers
 * stops granting access on its own. `paused` and `canceled` never do —
 * cancelling mid-period leaves the status `active` (with a scheduled change)
 * until the period ends, so a customer who cancelled keeps what they paid for.
 */
export function paddleHasAccess(
  status: PaddleStatus | string | null | undefined,
  currentPeriodEnd: Date | null | undefined,
  now: Date
): boolean {
  switch (status) {
    case "active":
    case "trialing":
      return true;
    case "past_due":
      return currentPeriodEnd != null && currentPeriodEnd.getTime() > now.getTime();
    default:
      return false;
  }
}

/**
 * Mercado Pago sends "cancelled" when a subscription really ends. A "paused"
 * subscription is usually a renewal being retried, so it keeps the paid plan
 * during the grace period instead of dropping access the second a payment
 * hiccups.
 */
export function resolvePlanForStatus(
  plan: PaidPlanName,
  status: SubscriptionStatus
): UserPlan {
  return status === "cancelled" ? "free" : plan;
}

export type TrialRow = {
  plan: UserPlan;
  /** null when the user never started a trial */
  trialEndsAt: Date | null;
  /** set as soon as there is a real subscription behind the account */
  mpPreapprovalId: string | null;
};

export type TrialView = {
  /** what the badge and the feature gates should show */
  plan: UserPlan;
  /** whether `startPlusTrial` would still accept this user */
  trialAvailable: boolean;
  /** whether the user's trial ran out and they should be told about it */
  trialEnded: boolean;
};

/**
 * A trial only downgrades someone who is still on it.
 *
 * `trial_ends_at` is never cleared when a trialling user goes on to pay, so it
 * stays in the past forever. Reading `plan === "plus" && trialEndsAt < now`
 * alone would therefore flip a *paying* Plus subscriber to "free" fourteen days
 * after they started their trial: Free badge, features taken away, told to buy
 * something they already bought. The `mp_preapprovalId` guard is what keeps the
 * trial and the paid subscription as separate states.
 */
export function resolveTrialView(row: TrialRow, now: Date): TrialView {
  const expired = row.trialEndsAt !== null && row.trialEndsAt < now;
  const inTrial = row.plan === "plus" && row.trialEndsAt !== null && row.mpPreapprovalId === null;

  return {
    plan: inTrial && expired ? "free" : row.plan,
    trialAvailable:
      row.plan === "free" && row.trialEndsAt === null && row.mpPreapprovalId === null,
    trialEnded: inTrial && expired
  };
}
