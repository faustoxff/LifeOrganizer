import "server-only";
import { NextResponse } from "next/server";
import { getPaddle } from "@/lib/paddle";
import { getUserPlanRow, requireAuth } from "@/lib/server-auth";

/**
 * Opens Paddle's customer portal for the signed-in user.
 *
 * The portal session is minted here, with the server API key, from the customer
 * id the webhook stored for THIS user — never from anything the browser sends.
 * A user can therefore only ever be sent to their own portal. The returned link
 * is a short-lived, pre-authenticated URL; it is handed to the browser and not
 * stored or logged.
 */
export async function POST() {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await getUserPlanRow(userId);
  const customerId = row?.paddle_customer_id as string | null | undefined;
  if (!customerId) {
    return NextResponse.json({ error: "No subscription to manage" }, { status: 404 });
  }
  const subscriptionId = row?.paddle_subscription_id as string | null | undefined;

  try {
    const session = await getPaddle().customerPortalSessions.create(
      customerId,
      subscriptionId ? [subscriptionId] : []
    );
    // `urls.general.overview` is the portal home; the per-subscription links
    // (cancel, update payment method) are reachable from it.
    return NextResponse.json({ url: session.urls.general.overview });
  } catch (err) {
    console.error("Paddle portal session failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Failed to open the portal" }, { status: 502 });
  }
}
