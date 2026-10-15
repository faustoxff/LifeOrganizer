// Paddle configuration that is safe for both server and browser: price ids,
// environment and the webhook secret lookup. No `server-only` here on purpose —
// the plans page needs the price ids and they are public by design.

import type { PaidPlanName } from "@/lib/subscription-plans";

/**
 * Billing intervals the catalog knows about. Only "monthly" is sold today.
 * To add a yearly price: add "yearly" here, add the two env vars in
 * `PRICE_IDS` below, and offer it in the UI. Webhooks, the plan mapping and
 * the checkout hook already work on price ids and need no change.
 */
export type BillingInterval = "monthly";
export const DEFAULT_INTERVAL: BillingInterval = "monthly";

/**
 * Price ids per plan and interval.
 *
 * Each `process.env.NEXT_PUBLIC_*` access is written out literally because
 * Next.js only inlines public variables it can see by name; a dynamic lookup
 * would be `undefined` in the browser. The legacy `PADDLE_PRICE_*` names are a
 * server-side fallback for deployments that configured them before the names
 * were unified.
 */
function priceIds(): Record<PaidPlanName, Partial<Record<BillingInterval, string | undefined>>> {
  return {
    plus: { monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PLUS || process.env.PADDLE_PRICE_PLUS },
    pro: { monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO || process.env.PADDLE_PRICE_PRO }
  };
}

export function priceIdFor(
  plan: PaidPlanName,
  interval: BillingInterval = DEFAULT_INTERVAL
): string | undefined {
  return priceIds()[plan][interval] || undefined;
}

/**
 * Which plan a price id belongs to, across every interval. Returns null for a
 * price that is not ours rather than guessing a tier.
 */
export function planForPriceId(priceId: string | undefined | null): PaidPlanName | null {
  if (!priceId) return null;
  const catalog = priceIds();
  for (const plan of Object.keys(catalog) as PaidPlanName[]) {
    for (const id of Object.values(catalog[plan])) {
      if (id && id === priceId) return plan;
    }
  }
  return null;
}

/** "sandbox" unless production is explicitly asked for. */
export function paddleEnvironmentName(): "sandbox" | "production" {
  return process.env.NEXT_PUBLIC_PADDLE_ENV === "production" ? "production" : "sandbox";
}

/**
 * The webhook signing secret. `PADDLE_WEBHOOK_SECRET` is the canonical name;
 * `PADDLE_NOTIFICATION_WEBHOOK_SECRET` is kept as an alias so an existing
 * deployment keeps working until it is renamed.
 */
export function webhookSecret(): string | undefined {
  return process.env.PADDLE_WEBHOOK_SECRET || process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET || undefined;
}
