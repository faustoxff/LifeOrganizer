import "server-only";
import { NextResponse } from "next/server";
import { EventName, type EventEntity, type Subscription } from "@paddle/paddle-node-sdk";
import { getPaddle, readSubscription } from "@/lib/paddle";
import { planForPriceId, webhookSecret } from "@/lib/paddle-config";
import { findUserIdByPreapprovalId, syncSubscription } from "@/lib/server-auth";
import type { PaidPlanName } from "@/lib/subscription-plans";

/**
 * Receives Paddle webhooks.
 *
 * Two facts about the delivery shape the whole handler is built around:
 *
 *  - Only a `2xx` within five seconds counts as delivered. Every other status
 *    is retried — live gets 60 attempts over roughly three days — so a failure
 *    here is recoverable as long as we never answer `2xx` to something we did
 *    not actually apply.
 *  - The signature covers the raw bytes, so the body is read as text before
 *    anything parses it. Re-serialising the JSON produces a different byte
 *    string and every delivery would look forged.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("paddle-signature");

  if (!signature || !rawBody) {
    return NextResponse.json({ error: "Missing signature or body" }, { status: 400 });
  }

  try {
    const paddle = getPaddle();
    // Throws on a bad signature, an expired timestamp or a malformed payload.
    const event = await paddle.webhooks.unmarshal(
      rawBody,
      webhookSecret() ?? "",
      signature
    );
    if (!event) return NextResponse.json({ received: true });

    await processEvent(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    // One catch, one non-2xx. `unmarshal` throws the same for a forged request
    // and for a rotated secret that has not been redeployed, so splitting the
    // status codes would be theatre — and answering 2xx here would throw the
    // event away instead of letting Paddle retry it.
    console.error("Paddle webhook failed", err);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}

/**
 * Paddle delivers at least once: the same event id arrives on every retry, so
 * every branch here has to converge on the same state rather than accumulate.
 * `syncSubscription` is an upsert keyed on user id, which makes that automatic.
 */
async function processEvent(event: EventEntity): Promise<void> {
  switch (event.eventType) {
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionCanceled: {
      // Narrowing on eventType is what makes `data` a Subscription rather than
      // the union of every notification shape.
      const sub = event.data as Subscription;
      return syncSubscriptionEvent(sub);
    }
    default:
      // Subscribed to events this app does not act on yet (customer.*,
      // transaction.completed). Acknowledging them stops Paddle retrying a
      // delivery that was never going to change anything.
      return;
  }
}

async function syncSubscriptionEvent(sub: Subscription): Promise<void> {
  const { priceId, userId, status } = readSubscription(sub);
  if (!status) return;

  const plan: PaidPlanName | null = planForPriceId(priceId);
  if (!plan) {
    // A price that is not ours. Guessing a tier would hand someone a plan they
    // did not buy, so the event is left unapplied for a human to look at.
    console.error(`Paddle subscription on an unknown price ${priceId}; not granting a plan`);
    return;
  }

  const subscriptionId = sub.id;
  const ownerId = userId || (await findUserIdByPreapprovalId(subscriptionId));
  if (!ownerId) {
    // Throwing keeps this a non-2xx so Paddle retries. Attribution can arrive
    // on a later event even if it was missing here.
    console.error(`Cannot attribute Paddle subscription ${subscriptionId}`);
    throw new Error(`Unknown subscription owner: ${subscriptionId}`);
  }

  await syncSubscription({
    userId: ownerId,
    plan,
    // The column is named for Mercado Pago's preapproval id and now holds
    // whichever provider issued the subscription. No migration stands between
    // an existing row and a working lookup.
    mpPreapprovalId: subscriptionId,
    payerEmail: "",
    status
  });
}