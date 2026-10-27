"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAppLanguage } from "@/components/language-provider";
import { LegalLinks } from "@/components/legal/legal-links";
import { copy as appCopy, type AppLanguage } from "@/lib/i18n";
import { demoCopy, landingCopy } from "@/lib/landing-copy";
import { LEGAL } from "@/lib/legal-config";

// Same bolt used by the in-app logo (components/animated-logo.tsx).
const BOLT = "M 32 5 L 8 35 L 30 35 L 28 55 L 52 25 L 30 25 Z";

export function LandingContent({ initialLanguage }: { initialLanguage: AppLanguage }) {
  const { language } = useAppLanguage();
  // Render the server-detected language first, then follow the provider (browser / manual choice).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const lang = mounted ? language : initialLanguage;

  const t = landingCopy[lang];
  const plansCopy = appCopy[lang].plans;
  const demo = demoCopy[lang];
  const calendarCopy = appCopy[lang].calendar;

  const plans = [
    {
      name: "Free",
      price: plansCopy.free,
      note: "",
      items: plansCopy.freeFeatures as readonly string[],
      cta: plansCopy.startFree,
      highlight: false
    },
    {
      name: "Plus",
      price: `US$${LEGAL.prices.plus}`,
      note: `${plansCopy.perMonth} · ${plansCopy.trialBadge(LEGAL.trialDays)}`,
      items: plansCopy.plusFeatures as readonly string[],
      cta: plansCopy.subscribePlus,
      highlight: true
    },
    {
      name: "Pro",
      price: `US$${LEGAL.prices.pro}`,
      note: plansCopy.perMonth,
      items: plansCopy.proFeatures as readonly string[],
      cta: plansCopy.subscribePro,
      highlight: false
    }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <span className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
          <svg viewBox="0 0 60 60" className="h-6 w-6 text-primary" aria-hidden="true">
            <path d={BOLT} fill="currentColor" />
          </svg>
          Spark
        </span>
        <nav className="flex items-center gap-2 text-sm sm:gap-3">
          <Link href="/sign-in" className="px-3 py-2 text-muted-foreground hover:text-foreground">
            {t.login}
          </Link>
          <Link
            href="/sign-up"
            className="hidden rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 sm:inline-block"
          >
            {plansCopy.startFree}
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-20 pt-12 md:grid-cols-2 md:pt-20">
          <div>
            <p className="mb-4 inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              {t.badge}
            </p>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
              {t.heroTitle}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t.heroText}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className="rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90"
              >
                {plansCopy.startFree}
              </Link>
              <a href="#plans" className="rounded-lg border border-border px-6 py-3 hover:bg-secondary">
                {t.seePlans}
              </a>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t.noCard}</p>
          </div>
          <div className="flex justify-center">
            <Image
              src="/milo-green.webp"
              alt="Milo"
              width={984}
              height={930}
              priority
              className="h-auto w-full max-w-[16rem] md:max-w-[21rem]"
            />
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 pb-8">
          <div
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/40"
            role="img"
            aria-label={demo.rec}
          >
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-muted" />
              <span className="h-2.5 w-2.5 rounded-full bg-muted" />
              <span className="h-2.5 w-2.5 rounded-full bg-muted" />
            </div>
            <div className="p-4 sm:p-5">
              <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary/90">
                  ✦ IA · {calendarCopy.todayRecommendation}
                </p>
                <p className="mt-3 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{demo.rec}</p>
                <p className="mt-3 text-sm leading-relaxed text-foreground/80">{demo.reason}</p>
              </div>
              <ul className="mt-3 space-y-2">
                {demo.steps.map((step, i) => (
                  <li key={step} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
                    {i === 0 ? (
                      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        ✓
                      </span>
                    ) : (
                      <span className="h-4 w-4 flex-shrink-0 rounded-full border border-muted-foreground/60" />
                    )}
                    <span className={i === 0 ? "text-muted-foreground line-through" : undefined}>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-semibold">{t.featuresTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.features.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-semibold">{t.howTitle}</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {t.steps.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-border bg-card p-5">
                <span className="font-display text-2xl text-primary">{i + 1}</span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="plans" className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-semibold">{plansCopy.title}</h2>
          <p className="mt-2 text-muted-foreground">{plansCopy.subtitle}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`flex flex-col rounded-xl border bg-card p-6 ${
                  p.highlight ? "border-primary" : "border-border"
                }`}
              >
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-3 font-display text-4xl font-semibold">{p.price}</p>
                <p className="min-h-4 text-xs text-muted-foreground">{p.note}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.items.map((item) => (
                    <li key={item}>✓ {item}</li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={`mt-6 rounded-lg px-4 py-2.5 text-center font-medium ${
                    p.highlight ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary"
                  }`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t.priceNote}</p>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="font-display text-3xl font-semibold">{t.faqTitle}</h2>
          <div className="mt-6 space-y-3">
            {t.faqs.map((f) => (
              <details key={f.q} className="rounded-xl border border-border bg-card p-4">
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 text-center">
          <h2 className="font-display text-3xl font-semibold">{t.finalTitle}</h2>
          <Link
            href="/sign-up"
            className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90"
          >
            {t.finalCta}
          </Link>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-8">
        <LegalLinks />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {LEGAL.serviceName} · {LEGAL.operatorName}
        </p>
      </footer>
    </div>
  );
}
