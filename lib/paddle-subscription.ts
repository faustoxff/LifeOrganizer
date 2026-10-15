import { paddleHasAccess, type PaddleStatus, type PaidPlanName } from "@/lib/subscription-plans";

// Pure logic of the Paddle webhook: turning an event into a snapshot of the
// subscription, and deciding whether that snapshot may overwrite what is stored.
// No database and no SDK runtime here, so all of it is unit tested.

/** The fields of a Paddle subscription this app reads (SDK entity or notification). */
export type SubscriptionLike = {
  id: string;
  status: string;
  customerId: string;
  items?: { price?: { id: string } | null }[] | null;
  currentBillingPeriod?: { endsAt: string } | null;
  scheduledChange?: { action: string } | null;
  customData?: Record<string, unknown> | null;
};

export type SubscriptionSnapshot = {
  subscriptionId: string;
  customerId: string;
  status: PaddleStatus;
  priceIds: string[];
  currentPeriodEnd: Date | null;
  /** The customer cancelled and keeps the plan until `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
  /** `custom_data.user_id` set by our checkout. A hint, never proof. */
  userId: string | null;
  /** When Paddle says this state was true. Orders events that arrive shuffled. */
  eventAt: Date;
};

const STATUSES: readonly string[] = ["active", "trialing", "past_due", "paused", "canceled"];

export function snapshotFromSubscription(sub: SubscriptionLike, eventAtIso: string): SubscriptionSnapshot | null {
  // A status Paddle adds later must not be guessed at.
  if (!STATUSES.includes(sub.status)) return null;
  const eventAt = new Date(eventAtIso);
  if (Number.isNaN(eventAt.getTime())) return null;

  const endsAt = sub.currentBillingPeriod?.endsAt ? new Date(sub.currentBillingPeriod.endsAt) : null;
  const rawUser = sub.customData?.user_id;

  return {
    subscriptionId: sub.id,
    customerId: sub.customerId,
    status: sub.status as PaddleStatus,
    priceIds: (sub.items ?? []).map((i) => i.price?.id).filter((id): id is string => Boolean(id)),
    currentPeriodEnd: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
    cancelAtPeriodEnd: sub.scheduledChange?.action === "cancel",
    userId: typeof rawUser === "string" && rawUser ? rawUser : null,
    eventAt
  };
}

/** What `user_plans.plan` should hold for a subscription in this status. */
export function planToStore(plan: PaidPlanName, status: PaddleStatus): PaidPlanName | "free" {
  // paused/canceled grant nothing. past_due keeps the tier: whether it still
  // grants access is decided at read time from `current_period_end`.
  return status === "canceled" || status === "paused" ? "free" : plan;
}

export type StoredPaddleState = {
  paddleSubscriptionId: string | null;
  paddleStatus: string | null;
  currentPeriodEnd: Date | null;
  eventAt: Date | null;
};

export type ApplyDecision = "apply" | "stale" | "superseded";

/**
 * May `incoming` overwrite `current`?
 *
 *  - Nothing stored for Paddle yet -> apply.
 *  - Same subscription -> apply unless an event with a LATER `occurred_at` was
 *    already applied. Equal timestamps apply, so a redelivery is a no-op rewrite.
 *  - A different subscription -> apply only when it grants access and the stored
 *    one no longer does (a re-subscription after cancelling). A late event of an
 *    old subscription, or a second concurrent subscription, never takes over.
 */
export function decideApply(current: StoredPaddleState | null, incoming: SubscriptionSnapshot, now: Date): ApplyDecision {
  if (!current || !current.paddleSubscriptionId) return "apply";

  if (current.paddleSubscriptionId === incoming.subscriptionId) {
    return current.eventAt && incoming.eventAt.getTime() < current.eventAt.getTime() ? "stale" : "apply";
  }

  const currentGrants = paddleHasAccess(current.paddleStatus, current.currentPeriodEnd, now);
  const incomingGrants = paddleHasAccess(incoming.status, incoming.currentPeriodEnd, now);
  return !currentGrants && incomingGrants ? "apply" : "superseded";
}
