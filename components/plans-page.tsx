"use client";

import { LegalLinks } from "@/components/legal/legal-links";
import { Check, Loader2, Sparkles, X, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { LEGAL } from "@/lib/legal-config";
import { useUserPlan } from "@/lib/use-user-plan";
import { cn } from "@/lib/utils";

const TRIAL_DAYS = 14;

type PlanId = "free" | "plus" | "pro";

export function PlansPage() {
  const router = useRouter();
  const { copy } = useAppLanguage();
  const plans = copy.plans;
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState("");
  const { trialAvailable, isLoaded } = useUserPlan();

  async function handleCheckout(planId: "plus" | "pro") {
    setError("");
    setLoadingPlan(planId);
    try {
      const res = await fetch("/api/subscriptions/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = (await res.json()) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error ?? "checkout_failed");
      window.location.href = data.checkoutUrl;
    } catch {
      setError(copy.errors.unexpected);
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

  const PLANS: {
    id: PlanId;
    name: string;
    price: number | null;
    description: string;
    highlighted: boolean;
    trial: boolean;
    features: string[];
  }[] = [
    {
      id: "free",
      name: "Free",
      price: null,
      description: plans.freeFeatures[0],
      highlighted: false,
      trial: false,
      features: plans.freeFeatures as unknown as string[],
    },
    {
      id: "plus",
      name: "Plus",
      price: 9000,
      description: "",
      highlighted: true,
      trial: true,
      features: plans.plusFeatures as unknown as string[],
    },
    {
      id: "pro",
      name: "Pro",
      price: 30000,
      description: "",
      highlighted: false,
      trial: false,
      features: plans.proFeatures as unknown as string[],
    },
  ];

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <button
        onClick={() => router.push("/app")}
        className="absolute left-4 top-4 z-10 flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label="Volver"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Header */}
      <motion.div
        className="relative z-10 mb-12 text-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
          <Zap className="h-3 w-3" />
          {plans.badge}
        </div>
        <h1 className="text-4xl font-bold tracking-tight">{plans.title}</h1>
        <p className="mt-3 max-w-md text-muted-foreground">{plans.subtitle}</p>
      </motion.div>

      {/* Cards */}
      <div className="relative z-10 flex w-full max-w-4xl flex-col gap-5 sm:flex-row sm:items-stretch">
        {PLANS.map((plan, i) => (
          <motion.div
            key={plan.id}
            className={cn(
              "relative flex flex-1 flex-col rounded-2xl border p-6 transition-shadow",
              plan.highlighted
                ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
                : "border-border bg-card"
            )}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            whileHover={{ y: -4 }}
          >
            <div className="relative flex h-full flex-col">
              {plan.highlighted && (
                <div className="absolute -top-3.5 left-1/2 z-10 -translate-x-1/2">
                  <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow shadow-primary/40">
                    <Sparkles className="h-3 w-3" />
                    {plans.mostPopular}
                  </span>
                </div>
              )}
              {plan.id === "pro" && (
                <div className="absolute -top-3.5 left-1/2 z-10 -translate-x-1/2">
                  <span className="whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm">
                    {plans.recommended}
                  </span>
                </div>
              )}

              {/* Plan name & price */}
              <div className="mb-6 pt-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Spark
                </p>
                <h2 className="mt-1 text-2xl font-bold">{plan.name}</h2>
                <div className="mt-3 flex items-end gap-1">
                  {plan.price ? (
                    <>
                      <span className="text-4xl font-bold">
                        $<AnimatedNumber value={plan.price} format={(n) => n.toLocaleString("es-AR")} />
                      </span>
                      <span className="mb-1 text-sm text-muted-foreground">
                        ARS {plans.perMonth}
                      </span>
                    </>
                  ) : (
                    <span className="text-4xl font-bold">{plans.free}</span>
                  )}
                </div>

                {/* The charge is in pesos and the store cannot be denominated in
                    anything else, but half the people who might pay for this do
                    not price in pesos. The reference is a second signal, not a
                    second offer: both figures come from LEGAL.prices and
                    PLAN_PRICES_ARS, which tests/pricing.test.ts holds together,
                    so the two can never quote different plans. */}
                {plan.price && plan.id !== "free" ? (
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    ≈ US${LEGAL.prices[plan.id as "plus" | "pro"]}
                  </p>
                ) : null}

                {plan.trial ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    <Sparkles className="h-3 w-3" />
                    {plans.trialBadge(TRIAL_DAYS)}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="mb-6 flex flex-1 flex-col gap-3 border-t border-border/60 pt-5">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5 text-sm">
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 flex-shrink-0",
                        plan.highlighted ? "text-primary" : "text-foreground/70"
                      )}
                    />
                    <span className="text-foreground">{feat}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div className="mt-auto flex flex-col gap-2">
                <Button
                  className={cn(
                    "w-full",
                    !plan.highlighted && "border-border bg-secondary/60 hover:bg-secondary"
                  )}
                  variant={plan.highlighted ? "default" : "outline"}
                  disabled={loadingPlan === plan.id}
                  onClick={() =>
                    plan.id === "free"
                      ? router.push("/app")
                      : plan.id === "plus"
                        ? trialAvailable
                          ? handleStartTrial()
                          : handleCheckout("plus")
                        : handleCheckout("pro")
                  }
                >
                  {loadingPlan === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : plan.id === "free" ? (
                    plans.startFree
                  ) : plan.id === "plus" ? (
                    plans.subscribePlus
                  ) : (
                    plans.subscribePro
                  )}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  {plan.trial && (!isLoaded || trialAvailable) ? plans.trialNote : " "}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {error && (
        <p className="relative z-10 mt-4 text-center text-sm text-destructive">{error}</p>
      )}

      {/* Footer note */}
      <motion.p
        className="relative z-10 mt-8 text-center text-xs text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        {plans.footer}
      </motion.p>
      <LegalLinks className="relative z-10 mt-3" />
    </div>
  );
}
