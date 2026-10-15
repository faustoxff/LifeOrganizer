import "server-only";
import { NextResponse } from "next/server";
import { COUNTRY_HEADER, getLocalizedPrices } from "@/lib/paddle-prices";
import { requireAuth } from "@/lib/server-auth";

/**
 * Localised plan prices for the signed-in plans screen. The public /pricing page
 * reads the same data on the server (lib/paddle-prices.ts), so this route stays
 * behind a session like every other /api route.
 */
export async function GET(request: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prices = await getLocalizedPrices(request.headers.get(COUNTRY_HEADER));
    return NextResponse.json({
      prices: Object.fromEntries(Object.entries(prices).map(([plan, formatted]) => [plan, { formatted }]))
    });
  } catch (err) {
    console.error("Paddle price preview failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Failed to load prices" }, { status: 502 });
  }
}
