import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the `Paddle-Signature` header of a Paddle Billing webhook.
 *
 * Header shape: `ts=1671552777;h1=<hex>` — the signed payload is `<ts>:<raw body>`
 * and `h1` is its HMAC-SHA256 (hex) with the notification destination's secret.
 *
 * Why this is not just `paddle.webhooks.unmarshal`: the SDK (3.10.0) allows only
 * 5 seconds between `ts` and now, and when the header carries several `h1`
 * values (Paddle sends more than one while a secret is being rotated) it keeps
 * only the last one. Either makes valid deliveries fail. Here every `h1` is
 * tried, in constant time, and the window is wider.
 *
 * TODO(verificar): developer.paddle.com was unreachable when this was written,
 * so the replay window is a choice, not Paddle's documented value. The handler
 * is idempotent, so a replayed delivery is harmless; widen or drop the window
 * if Paddle's retries turn out to reuse the original timestamp.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyPaddleSignature(params: {
  rawBody: string;
  header: string | null | undefined;
  secret: string | null | undefined;
  nowMs?: number;
  toleranceSeconds?: number;
}): boolean {
  const { rawBody, header, secret } = params;
  if (!header || !secret) return false;

  let ts: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "h1" && value) signatures.push(value);
  }
  if (!ts || signatures.length === 0) return false;

  const tsSeconds = Number(ts);
  if (!Number.isFinite(tsSeconds)) return false;
  const nowSeconds = (params.nowMs ?? Date.now()) / 1000;
  const tolerance = params.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - tsSeconds) > tolerance) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest();
  return signatures.some((candidate) => {
    // Hex of a SHA-256 digest: anything else cannot match, and timingSafeEqual
    // throws on buffers of different length.
    if (!/^[0-9a-fA-F]{64}$/.test(candidate)) return false;
    return timingSafeEqual(expected, Buffer.from(candidate, "hex"));
  });
}
