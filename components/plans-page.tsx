"use client";

import { PlanCards, PlansFooter, PlansHeader, type PlanId } from "@/components/plan-cards";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { useUser } from "@clerk/nextjs";
import { billingCopy } from "@/lib/billing-copy";
import { priceIdFor } from "@/lib/paddle-config";
import { useLocalizedPrices, usePaddleCheckout } from "@/lib/use-paddle-checkout";
import { useUserPlan } from "@/lib/use-user-plan";

export function PlansPage() {
  const router = useRouter();
  const { copy, language } = useAppLanguage();
  const billing = billingCopy(language);
  const { user } = useUser();
  // Paddle's own formatted total in the buyer's currency, once it loads. Until
  // then (or if it never does) the USD list price in PlanCards is what is shown.
  const localizedPrices = useLocalizedPrices();
  const [purchased, setPurchased] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState("");
  const { trialAvailable, isLoaded } = useUserPlan();
  // The webhook activates the plan, which lands a moment after Paddle reports
  // the payment. Refreshing on completion closes that gap so the buyer is not
  // looking at a stale "Free" badge while their subscription is already live.
  const checkout = usePaddleCheckout(() => {
    setPurchased(true);
    router.refresh();
  });

  async function handleCheckout(planId: "plus" | "pro") {
    setError("");
    const priceId = priceIdFor(planId);
    if (!priceId) {
      setError(copy.errors.unexpected);
      return;
    }
    setLoadingPlan(planId);
    try {
      // Opens Paddle's checkout over the page. Nobody leaves the app, so a
      // misclick is a closed modal rather than a lost session.
      // The Clerk id and email tie the purchase to this account. The plan
      // itself is still granted only by the verified webhook, never from here.
      await checkout.open({
        priceId,
        userId: user?.id,
        email: user?.primaryEmailAddress?.emailAddress
      });
    } catch {
      setError(billing.checkoutNotReady);
    } finally {
      setLoadingPlan(null);
    }
  }

  async function handleStartTrial() {
    setError("");
    setLoadingPlan("plus");
    try {
      const res = await fetch("/api/subscriptions/trial", { method: "POST" });
      if (res.ok) {
        router.push("/app");
        return;
      }
      // 409: the trial was already used, so the user is on Free with an
      // expired one. Sending them back to an error would leave Plus
      // unpurchasable — the checkout branch existed in the API but nothing
      // ever called it with "plus". This is the only way to pay for Plus.
      if (res.status === 409) {
        await handleCheckout("plus");
        return;
      }
      // 400: already on a paid plan (or Pro). They are subscribed; nothing to
      // buy, so take them to the product rather than showing a generic error.
      if (res.status === 400) {
        router.push("/app");
        return;
      }
      throw new Error("trial_failed");
    } catch {
      setError(copy.errors.unexpected);
      setLoadingPlan(null);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <button
        onClick={() => router.push("/app")}
        className="absolute left-4 top-4 z-10 flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label="Volver"
      >
        <X className="h-5 w-5" />
      </button>

      <PlansHeader />

      <PlanCards
        localizedPrices={localizedPrices}
        loadingPlan={loadingPlan}
        showTrialNote={!isLoaded || trialAvailable}
        onSelect={(id) =>
          id === "free"
            ? router.push("/app")
            : id === "plus"
              ? trialAvailable
                ? handleStartTrial()
                : handleCheckout("plus")
              : handleCheckout("pro")
        }
      />

      {purchased && (
        <div
          role="status"
          className="relative z-10 mt-4 max-w-md rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-center"
        >
          <p className="text-sm font-semibold text-foreground">{billing.checkoutSuccessTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{billing.checkoutSuccessBody}</p>
        </div>
      )}
      {error && (
        <p className="relative z-10 mt-4 text-center text-sm text-destructive">{error}</p>
      )}

      <PlansFooter />
    </div>
  );
}
