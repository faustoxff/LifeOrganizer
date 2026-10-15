import "server-only";
import {
  Environment,
  LogLevel,
  Paddle,
  type PaddleOptions,
  type Subscription
} from "@paddle/paddle-node-sdk";
import { paddleEnvironmentName } from "@/lib/paddle-config";
import type { PaidPlanName, SubscriptionStatus } from "@/lib/subscription-plans";

export { planForPriceId } from "@/lib/paddle-config";

// Paddle is the merchant of record: it is the legal seller, it charges the
// buyer, it collects and remits the sales tax for every country except the
// merchant's own, and it hands over the rest. That is the same contract
// Lemon Squeezy offered, and the reason the tax burden here is Argentina's
// alone and not a dozen other jurisdictions'.

export type { PaidPlanName as PaidPlan };

export function getPaddle(): Paddle {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("PADDLE_API_KEY is not set");

  const options: PaddleOptions = {
    environment:
      paddleEnvironmentName() === "production" ? Environment.production : Environment.sandbox,
    logLevel: LogLevel.error
  };
  return new Paddle(apiKey, options);
}

/**
 * Maps a Paddle subscription status onto the three states this app stores.
 *
 * `past_due` deliberately becomes "paused" rather than "cancelled": Paddle keeps
 * retrying the card and the plan should survive a failed renewal the way a
 * good host does. `paused` is a different thing — the subscription is idle by
 * request, with no billing and no service — so it loses access.
 *
 * `canceled` is terminal. Cancelling mid-period leaves the status at "active"
 * with a `scheduledChange`; the flip arrives later, when access really ends.
 */
export function toSubscriptionStatus(status: Subscription["status"]): SubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "authorized";
    case "past_due":
      return "paused";
    case "paused":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * A subscription's price id, its custom-data user id and its status, in one
 * shape the webhook handler can use without knowing Paddle's event layout.
 */
export function readSubscription(sub: Subscription): {
  priceId: string | undefined;
  userId: string | undefined;
  status: SubscriptionStatus | null;
} {
  const custom = (sub as unknown as { customData?: { user_id?: string } }).customData;
  return {
    priceId: sub.items?.[0]?.price?.id,
    userId: custom?.user_id,
    status: toSubscriptionStatus(sub.status)
  };
}