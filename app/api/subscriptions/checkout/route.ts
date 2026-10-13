import "server-only";
import { NextResponse } from "next/server";
import { requireAuthWithEmail } from "@/lib/server-auth";
import { createCheckout, type PaidPlan } from "@/lib/paddle";

function isPaidPlan(value: unknown): value is PaidPlan {
  return value === "plus" || value === "pro";
}

/**
 * Creates a Paddle transaction and returns the hosted checkout URL.
 *
 * The email is deliberately not sent. Paddle's SDK does not accept it on a
 * transaction create, and attribution does not depend on it — the user id
 * rides in `custom_data`, which Paddle echoes back on every webhook.
 */
export async function POST(request: Request) {
  let userId: string;
  let email: string;
  try {
    ({ userId, email } = await requireAuthWithEmail());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { plan?: string };
  if (!isPaidPlan(body.plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  try {
    const checkoutUrl = await createCheckout({ plan: body.plan, userId, email });
    return NextResponse.json({ checkoutUrl });
  } catch (err) {
    console.error("Paddle checkout failed", err);
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 502 });
  }
}