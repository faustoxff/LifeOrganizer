"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Paddle as PaddleNamespace, PaddleSetupOptions } from "@paddle/paddle-js";

const PADDLE_SCRIPT = "https://cdn.paddle.com/paddle/v2/paddle.js";

/**
 * Paddle's overlay checkout.
 *
 * Opens the payment page in place instead of redirecting to it, so a buyer who
 * closes the modal is still on the plans page with the trial state intact —
 * which is the failure this replaces: someone who misclicks was thrown to
 * Paddle's own site and had to find their way back.
 *
 * Two things are deliberately not here:
 *  - The API key. It never reaches the browser. The client is initialised with
 *    a short-lived client token minted server-side per session.
 *  - Any price arithmetic. Paddle decides what the buyer pays in their own
 *    currency and formats it; those strings are displayed as they arrive.
 */

type Paddle = PaddleNamespace;
let paddlePromise: Promise<Paddle | null> | null = null;

/** Loads paddle.js once per page, however many components ask for it. */
function loadPaddle(): Promise<Paddle | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (paddlePromise) return paddlePromise;

  paddlePromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${PADDLE_SCRIPT}"]`);
    if (existing) {
      // The script fires a paddleInitialized event rather than resolving a
      // promise, so an already-present tag still needs the listener.
      if ((window as unknown as { Paddle?: Paddle }).Paddle) {
        resolve((window as unknown as { Paddle?: Paddle }).Paddle ?? null);
        return;
      }
      window.addEventListener("paddleInitialized", () => {
        resolve((window as unknown as { Paddle?: Paddle }).Paddle ?? null);
      });
      return;
    }

    const script = document.createElement("script");
    script.src = PADDLE_SCRIPT;
    script.async = true;
    script.onload = () => {
      resolve((window as unknown as { Paddle?: Paddle }).Paddle ?? null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return paddlePromise;
}

export function usePaddleCheckout(): {
  open: (params: { priceId: string; email?: string }) => Promise<void>;
  ready: boolean;
} {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const instance = await loadPaddle();
      if (!instance || cancelled) return;

      try {
        // Minted per session, never long-lived: it is public material and a
        // leaked one expires on its own.
        const res = await fetch("/api/paddle/client-token", { method: "POST" });
        if (!res.ok) return;
        const { token } = (await res.json()) as { token?: string };
        if (!token || cancelled) return;

        tokenRef.current = token;
        instance.Initialize({ token } as PaddleSetupOptions);
        if (!cancelled) setPaddle(instance);
      } catch {
        // Left uninitialised on purpose. The caller falls back to telling the
        // user plainly rather than opening a checkout that cannot work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(
    async ({ priceId, email }: { priceId: string; email?: string }) => {
      if (!paddle) throw new Error("checkout_not_ready");
      await paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        settings: { displayMode: "overlay", variant: "one-page" },
        ...(email ? { customer: { email } } : {})
      });
    },
    [paddle]
  );

  return { open, ready: Boolean(paddle) };
}

/**
 * The formatted total for a price, straight from Paddle.
 *
 * Used for display only. When the preview cannot be reached the caller keeps
 * whatever it already shows rather than rendering a blank.
 */
export function useLocalizedPrices(): Record<string, string> {
  const [prices, setPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/paddle/prices");
        if (!res.ok) return;
        const body = (await res.json()) as { prices?: Record<string, { formatted: string }> };
        if (!body.prices || cancelled) return;
        setPrices(
          Object.fromEntries(Object.entries(body.prices).map(([plan, v]) => [plan, v.formatted]))
        );
      } catch {
        // Leave the static price on screen; it is the same number Paddle bills.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return prices;
}

