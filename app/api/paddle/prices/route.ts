import "server-only";
import { NextResponse } from "next/server";
import { getPaddle } from "@/lib/paddle";
import { priceIdFor } from "@/lib/paddle-config";
import { requireAuth } from "@/lib/server-auth";

/**
 * Localised prices for the two paid plans, as Paddle formats them.
 *
 * The buyer is charged in their own currency, and the amount is decided by
 * Paddle's country and currency rules — not here. This route only asks Paddle
 * what the price is and passes the formatted string straight through: no
 * Intl.NumberFormat, no rounding, no exchange rate of our own. Re-formatting a
 * number Paddle already formatted is how a page ends up promising one price and
 * charging another.
 */

/** Vercel sets this; without it Paddle resolves the country itself. */
const COUNTRY_HEADER = "x-vercel-ip-country";

export async function GET(request: Request) {
  // Paddle's prices are public, but this route is only ever rendered from the
  // signed-in plans screen, and every other route in this app checks first.
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const paddle = getPaddle();

    const items = [
      { priceId: priceIdFor("plus"), plan: "plus" },
      { priceId: priceIdFor("pro"), plan: "pro" }
    ].filter((item) => item.priceId) as { priceId: string; plan: string }[];

    if (items.length === 0) {
      return NextResponse.json({ error: "No prices configured" }, { status: 503 });
    }

    // Only forward a country Paddle could act on. An absent header means Paddle
    // infers the country from the request, which is better than guessing.
    const country = request.headers.get(COUNTRY_HEADER);
    const preview = await paddle.pricingPreview.preview({
      items: items.map((item) => ({ priceId: item.priceId, quantity: 1 })),
      ...(country ? { countryCode: country.toUpperCase() as never } : {})
    });

    const prices: Record<string, { formatted: string }> = {};
    preview.details.lineItems.forEach((line) => {
      const match = items.find((item) => item.priceId === line.price?.id);
      if (!match) return;
      // Paddle's own formatting, passed through untouched. Anything else here
      // is a second place for the advertised price to disagree with the charge.
      prices[match.plan] = { formatted: line.formattedTotals.total };
    });

    return NextResponse.json({ prices });
  } catch (err) {
    console.error("Paddle price preview failed", err);
    return NextResponse.json({ error: "Failed to load prices" }, { status: 502 });
  }
}