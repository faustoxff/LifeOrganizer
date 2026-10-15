import "server-only";
import { NextResponse } from "next/server";
import { Webhooks } from "@paddle/paddle-node-sdk";
import { getPaddle } from "@/lib/paddle";
import { webhookSecret } from "@/lib/paddle-config";
import { verifyPaddleSignature } from "@/lib/paddle-signature";
import { findOwner, getStored, saveSubscription } from "@/lib/paddle-sync";
import { handlePaddleEvent } from "@/lib/paddle-webhook";

/**
 * Receives Paddle Billing webhooks.
 *
 * Things the shape of the delivery forces:
 *  - Only a `2xx` within five seconds counts as delivered; everything else is
 *    retried (live: 60 attempts over ~3 days). So a failure here is recoverable
 *    as long as a 2xx is never sent for something that was not applied.
 *  - The signature covers the raw bytes, so the body is read as text and
 *    verified BEFORE anything parses it. Re-serialised JSON would never match.
 *  - middleware.ts excludes this path: Clerk re-reading the body would change
 *    the bytes the signature covers.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  const secret = webhookSecret();
  if (!secret) {
    // Misconfiguration, not a forged request: 5xx so Paddle keeps retrying
    // until the variable is set instead of dropping paid events.
    console.error("Paddle webhook: PADDLE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const verified = verifyPaddleSignature({
    rawBody,
    header: request.headers.get("paddle-signature"),
    secret
  });
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let eventId = "unknown";
  let eventType = "unknown";
  try {
    const json = JSON.parse(rawBody) as { event_id?: string; event_type?: string };
    eventId = json.event_id ?? eventId;
    eventType = json.event_type ?? eventType;
    const event = Webhooks.fromJson(json as never);

    const paddle = getPaddle();
    const outcome = await handlePaddleEvent(event, {
      now: () => new Date(),
      findOwner,
      getStored,
      save: saveSubscription,
      fetchSubscription: (id) => paddle.subscriptions.get(id)
    });
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    // Ids and the error message only: the body holds customer data.
    console.error("Paddle webhook failed", {
      eventId,
      eventType,
      error: err instanceof Error ? err.message : "unknown"
    });
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
