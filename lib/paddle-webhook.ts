import { EventName, type EventEntity } from "@paddle/paddle-node-sdk";
import { planForPriceId } from "@/lib/paddle-config";
import {
  decideApply,
  planToStore,
  snapshotFromSubscription,
  type StoredPaddleState,
  type SubscriptionLike,
  type SubscriptionSnapshot
} from "@/lib/paddle-subscription";
import type { PaidPlanName } from "@/lib/subscription-plans";

/**
 * What the webhook does with a verified Paddle event, with every side effect
 * injected so the whole decision path is unit tested (see tests/paddle-webhook).
 *
 * Paddle delivers at least once and not in order. Two properties follow:
 *  - Idempotent: applying the same event twice writes the same row.
 *  - Order-tolerant: an event older than the one already applied is dropped, and
 *    `transaction.completed` re-reads the subscription from Paddle instead of
 *    trusting its own (possibly earlier-than-`subscription.created`) arrival.
 */
export type WebhookDeps = {
  now: () => Date;
  /** The account that already owns this subscription or Paddle customer, if any. */
  findOwner: (subscriptionId: string, customerId: string) => Promise<string | null>;
  getStored: (userId: string) => Promise<StoredPaddleState | null>;
  /** Writes the snapshot. Returns false when the database refused it as stale. */
  save: (userId: string, snapshot: SubscriptionSnapshot, plan: PaidPlanName | "free") => Promise<boolean>;
  fetchSubscription: (subscriptionId: string) => Promise<SubscriptionLike & { updatedAt: string }>;
};

export type WebhookOutcome = "applied" | "stale" | "superseded" | "ignored";

const SUBSCRIPTION_EVENTS = new Set<string>([
  EventName.SubscriptionCreated,
  EventName.SubscriptionUpdated,
  EventName.SubscriptionCanceled,
  EventName.SubscriptionPastDue,
  // Same entity, same handling: without these a pause, a resume or a trial
  // start would only be noticed at the next `subscription.updated`.
  EventName.SubscriptionActivated,
  EventName.SubscriptionPaused,
  EventName.SubscriptionResumed,
  EventName.SubscriptionTrialing
]);

export async function handlePaddleEvent(event: EventEntity, deps: WebhookDeps): Promise<WebhookOutcome> {
  if (SUBSCRIPTION_EVENTS.has(event.eventType)) {
    const snapshot = snapshotFromSubscription(event.data as unknown as SubscriptionLike, event.occurredAt);
    return snapshot ? applySnapshot(snapshot, deps) : "ignored";
  }

  if (event.eventType === EventName.TransactionCompleted) {
    const tx = event.data as unknown as {
      subscriptionId: string | null;
      customData?: Record<string, unknown> | null;
    };
    // A one-off payment, not a subscription charge: nothing to grant.
    if (!tx.subscriptionId) return "ignored";

    // The transaction only says "a payment succeeded". The subscription holds
    // the period end and status, so read it from Paddle: that is correct even
    // if this event beat `subscription.created`, and it carries Paddle's own
    // `updated_at`, which keeps the ordering guard meaningful.
    const sub = await deps.fetchSubscription(tx.subscriptionId);
    const snapshot = snapshotFromSubscription(sub, sub.updatedAt);
    if (!snapshot) return "ignored";
    const txUser = tx.customData?.user_id;
    if (!snapshot.userId && typeof txUser === "string" && txUser) snapshot.userId = txUser;
    return applySnapshot(snapshot, deps);
  }

  // customer.*, price.*, transaction.created ... acknowledged so Paddle stops retrying.
  return "ignored";
}

function resolvePlan(snapshot: SubscriptionSnapshot): PaidPlanName | null {
  for (const priceId of snapshot.priceIds) {
    const plan = planForPriceId(priceId);
    if (plan) return plan;
  }
  return null;
}

async function applySnapshot(snapshot: SubscriptionSnapshot, deps: WebhookDeps): Promise<WebhookOutcome> {
  // The database is the authority on who owns a subscription; `custom_data` is
  // set by the browser and is only believed for a subscription nobody owns yet.
  const owner = await deps.findOwner(snapshot.subscriptionId, snapshot.customerId);
  const userId = owner ?? snapshot.userId;
  if (!userId) {
    // Throwing keeps this a non-2xx so Paddle retries; a later event may carry the id.
    throw new Error(`Cannot attribute Paddle subscription ${snapshot.subscriptionId}`);
  }
  if (owner && snapshot.userId && owner !== snapshot.userId) {
    console.warn(`Paddle subscription ${snapshot.subscriptionId}: custom_data.user_id disagrees with its owner; keeping the owner`);
  }

  const plan = resolvePlan(snapshot);
  const endsAccess = snapshot.status === "canceled" || snapshot.status === "paused";
  if (!plan && !endsAccess) {
    // Guessing a tier would hand someone a plan they did not buy. Failing makes
    // Paddle retry, so a missing price env var is recoverable once it is set.
    throw new Error(`Paddle subscription ${snapshot.subscriptionId} is on a price that is not configured`);
  }
  const stored = planToStore(plan ?? "plus", snapshot.status);

  const decision = decideApply(await deps.getStored(userId), snapshot, deps.now());
  if (decision !== "apply") return decision;

  return (await deps.save(userId, snapshot, stored)) ? "applied" : "stale";
}
