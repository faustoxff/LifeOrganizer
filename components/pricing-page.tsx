"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppLanguage } from "@/components/language-provider";
import { PlanCards, PlansFooter, PlansHeader, type PlanId } from "@/components/plan-cards";
import { billingCopy } from "@/lib/billing-copy";

/**
 * The public pricing page: same plans, prices and wording as /plans (they come
 * from PlanCards), but anyone can read it. The buttons only route — nothing is
 * bought here:
 *   signed out -> sign-up, then back to /plans to start the trial or check out
 *   signed in  -> /plans (Free goes straight to the app)
 */
export function PricingPage({ initialPrices }: { initialPrices: Record<string, string> }) {
  const router = useRouter();
  const { language } = useAppLanguage();
  const billing = billingCopy(language);
  const { isSignedIn } = useAuth();

  function handleSelect(plan: PlanId) {
    if (isSignedIn) {
      router.push(plan === "free" ? "/app" : "/plans");
      return;
    }
    // `redirect_url` is the parameter Clerk's own protect() sends to sign-in, so
    // the sign-up flow lands back on the plans screen the same way.
    router.push(plan === "free" ? "/sign-up" : `/sign-up?redirect_url=${encodeURIComponent("/plans")}`);
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <Link
        href="/"
        className="absolute left-4 top-4 z-10 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {billing.pricingBack}
      </Link>

      <PlansHeader />
      <PlanCards localizedPrices={initialPrices} loadingPlan={null} showTrialNote onSelect={handleSelect} />
      <PlansFooter />
    </div>
  );
}
