import "server-only";
import { NextResponse } from "next/server";
import { getPaddle } from "@/lib/paddle";
import { requireAuth } from "@/lib/server-auth";

/**
 * Mints the short-lived client-side token Paddle.js needs to initialise.
 *
 * The token is public by design — it ships to the browser and is scoped to
 * nothing more than reading prices and opening a checkout. It is minted here
 * with the server API key so that key never leaves the server, and it is short
 * lived so a leaked one expires on its own.
 *
 * Requires a session. Without one there is no subscription to open, and an
 * anonymous token is one more thing to leak for nothing.
 */
export async function POST() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const paddle = getPaddle();
    // Paddle requires a name on every client token. It labels the token for the
    // merchant's own dashboard and has no effect on what it can do.
    const token = await paddle.clientTokens.create({ name: "Spark checkout" });
    return NextResponse.json({ token });
  } catch (err) {
    console.error("Paddle client token failed", err);
    return NextResponse.json({ error: "Failed to create checkout" }, { status: 502 });
  }
}