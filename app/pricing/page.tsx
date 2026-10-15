import type { Metadata } from "next";
import { headers } from "next/headers";
import { PricingPage } from "@/components/pricing-page";
import { resolveAppLanguage } from "@/lib/i18n";
import { COUNTRY_HEADER, getLocalizedPrices } from "@/lib/paddle-prices";

// Public on purpose: no auth.protect(). A payment reviewer, a search engine or a
// visitor deciding whether to sign up must be able to read the prices. It reads
// request headers (country, language), so it renders per request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const es = resolveAppLanguage(h.get("accept-language")?.split(",")[0]?.trim()) === "es";
  return {
    title: es ? "Precios · Spark" : "Pricing · Spark",
    description: es
      ? "Planes Free, Plus y Pro de Spark. Precios mensuales claros; los impuestos los gestiona Paddle."
      : "Spark's Free, Plus and Pro plans. Clear monthly prices; taxes are handled by Paddle.",
    alternates: { canonical: "/pricing" }
  };
}

export default async function Pricing() {
  const country = (await headers()).get(COUNTRY_HEADER);
  // Paddle's price in the visitor's currency. If it is unreachable or not
  // configured the page still renders, with the USD list price.
  const prices = await getLocalizedPrices(country).catch((err) => {
    console.error("Pricing page: localized prices unavailable", err instanceof Error ? err.message : "unknown");
    return {} as Record<string, string>;
  });
  return <PricingPage initialPrices={prices} />;
}
