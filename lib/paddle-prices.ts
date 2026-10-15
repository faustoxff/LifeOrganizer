import "server-only";
import { getPaddle } from "@/lib/paddle";
import { priceIdFor } from "@/lib/paddle-config";

/**
 * Localised prices for the two paid plans, as Paddle formats them.
 *
 * The buyer is charged in their own currency, and the amount is decided by
 * Paddle's country and currency rules — not here. This only asks Paddle what the
 * price is and passes the formatted string straight through: no
 * Intl.NumberFormat, no rounding, no exchange rate of our own. Re-formatting a
 * number Paddle already formatted is how a page ends up promising one price and
 * charging another.
 */

/** Vercel sets this; without it Paddle resolves the country itself. */
export const COUNTRY_HEADER = "x-vercel-ip-country";

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; prices: Record<string, string> }>();

/** Formatted monthly total per plan id ("plus" | "pro"). Throws if Paddle is unreachable. */
export async function getLocalizedPrices(country: string | null): Promise<Record<string, string>> {
  const items = [
    { priceId: priceIdFor("plus"), plan: "plus" },
    { priceId: priceIdFor("pro"), plan: "pro" }
  ].filter((item) => item.priceId) as { priceId: string; plan: string }[];
  if (items.length === 0) throw new Error("No prices configured");

  // Only forward a country Paddle could act on (two letters). An absent header
  // means Paddle infers it from the request, which beats guessing.
  const code = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
  const key = code ?? "-";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.prices;

  const preview = await getPaddle().pricingPreview.preview({
    items: items.map((item) => ({ priceId: item.priceId, quantity: 1 })),
    ...(code ? { countryCode: code as never } : {})
  });

  const prices: Record<string, string> = {};
  preview.details.lineItems.forEach((line) => {
    const match = items.find((item) => item.priceId === line.price?.id);
    if (match) prices[match.plan] = line.formattedTotals.total;
  });

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), prices });
  return prices;
}
