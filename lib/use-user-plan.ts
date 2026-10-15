"use client";

import { useEffect, useState } from "react";

export type UserPlan = "free" | "plus" | "pro";

export type SubscriptionInfo = {
  /** Paddle's status: active | trialing | past_due | paused | canceled */
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
};

type PlanResponse = {
  subscription?: SubscriptionInfo | null;
  plan: UserPlan;
  trialEndsAt: string | null;
  trialAvailable?: boolean;
  trialEnded?: boolean;
};

export function useUserPlan() {
  const [plan, setPlan] = useState<UserPlan>("free");
  const [trialEndsAt, setTrialEndsAt] = useState<Date | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Default true so a first paint still offers the trial; the /plans button
  // also falls back to checkout if the server says the trial is gone, so a
  // stale value here can route the user to the wrong button but never to a
  // dead end.
  const [trialAvailable, setTrialAvailable] = useState(true);
  const [trialEnded, setTrialEnded] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/subscriptions/me");
        if (!res.ok) throw new Error();
        const data = (await res.json()) as PlanResponse;
        if (!active) return;
        setPlan(data.plan);
        setTrialEndsAt(data.trialEndsAt ? new Date(data.trialEndsAt) : null);
        setTrialAvailable(data.trialAvailable ?? true);
        setTrialEnded(data.trialEnded ?? false);
        setSubscription(data.subscription ?? null);
      } catch {
        if (active) setPlan("free");
      } finally {
        if (active) setIsLoaded(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return { plan, trialEndsAt, trialDaysLeft, trialAvailable, trialEnded, subscription, isLoaded };
}
