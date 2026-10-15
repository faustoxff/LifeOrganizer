"use client";

import { useState } from "react";
import Link from "next/link";
import { useAppLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { billingCopy } from "@/lib/billing-copy";
import { useUserPlan } from "@/lib/use-user-plan";

const PLAN_NAMES = { free: "Free", plus: "Plus", pro: "Pro" } as const;

/**
 * Plan, status and next renewal, plus the way into Paddle's customer portal.
 * Display only: the plan shown here is whatever the server resolved from the
 * webhook-written subscription, and nothing on this screen can change it.
 */
export function SubscriptionSection() {
  const { language } = useAppLanguage();
  const t = billingCopy(language).settings;
  const { plan, subscription, isLoaded } = useUserPlan();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);

  if (!isLoaded) return null;

  async function openPortal() {
    setError(false);
    setOpening(true);
    try {
      const res = await fetch("/api/paddle/portal", { method: "POST" });
      const body = (await res.json()) as { url?: string };
      if (!res.ok || !body.url) throw new Error("portal");
      window.location.assign(body.url);
    } catch {
      setError(true);
      setOpening(false);
    }
  }

  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric" }) : null;
  const periodEnd = date(subscription?.currentPeriodEnd ?? null);
  const status = subscription?.status as keyof typeof t.statuses | undefined;

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="subscription-title">
      <h3 id="subscription-title" className="text-sm font-semibold">
        {t.title}
      </h3>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t.plan}</dt>
        <dd className="font-medium">{PLAN_NAMES[plan]}</dd>
        {subscription && (
          <>
            <dt className="text-muted-foreground">{t.status}</dt>
            <dd className="font-medium">{(status && t.statuses[status]) ?? subscription.status}</dd>
            {periodEnd && (
              <>
                <dt className="text-muted-foreground">{subscription.cancelAtPeriodEnd ? t.endsOn : t.renews}</dt>
                <dd className="font-medium">{periodEnd}</dd>
              </>
            )}
          </>
        )}
      </dl>

      {!subscription && <p className="mt-2 text-xs text-muted-foreground">{t.freeNote}</p>}
      {subscription?.cancelAtPeriodEnd && periodEnd && (
        <p className="mt-2 text-xs text-muted-foreground">{t.cancelsNote(periodEnd)}</p>
      )}
      {subscription?.status === "past_due" && <p className="mt-2 text-xs text-destructive">{t.pastDueNote}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {subscription?.canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={openPortal} disabled={opening}>
            {opening ? t.opening : t.manage}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href="/plans">{t.viewPlans}</Link>
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{t.portalError}</p>}
    </section>
  );
}
