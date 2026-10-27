"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Paddle as PaddleNamespace,
  PaddleEventData,
  PaddleSetupOptions
} from "@paddle/paddle-js";

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

/** The message of anything thrown, for logs and (while debugging) the UI. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
      const instance = (window as unknown as { Paddle?: Paddle }).Paddle ?? null;
      if (!instance) console.error("[paddle] paddle.js loaded but window.Paddle is undefined");
      resolve(instance);
    };
    script.onerror = (event) => {
      // Usually the CSP or an ad blocker. Cleared so a later mount can retry.
      console.error("[paddle] failed to load paddle.js from", PADDLE_SCRIPT, event);
      paddlePromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return paddlePromise;
}

export function usePaddleCheckout(onCompleted?: () => void): {
  open: (params: { priceId: string; email?: string }) => Promise<void>;
  ready: boolean;
} {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  // Why the checkout cannot open, kept so the click can report it instead of a
  // generic "not ready". Init runs on mount, so by the time someone clicks the
  // failure has already happened and left no trace in the network tab.
  const [initError, setInitError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fail = (message: string, err?: unknown) => {
      console.error(`[paddle] ${message}`, err ?? "");
      if (err instanceof Error && err.stack) console.error(err.stack);
      if (!cancelled) setInitError(message);
    };
    void (async () => {
      const instance = await loadPaddle();
      if (cancelled) return;
      if (!instance) {
        fail("paddle.js did not load (window.Paddle is undefined). Check the CSP and ad blockers.");
        return;
      }

      try {
        // Minted per session, never long-lived: it is public material and a
        // leaked one expires on its own.
        const res = await fetch("/api/paddle/client-token", { method: "POST" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          fail(`client token request failed: HTTP ${res.status} ${body}`);
          return;
        }
        const { token } = (await res.json()) as { token?: string };
        if (cancelled) return;
        if (!token) {
          fail("client token response had no token");
          return;
        }

        tokenRef.current = token;
        instance.Initialize({
          token,
          // The only way to learn that the payment went through from the
          // browser. Without it the modal closes and the page underneath is
          // unchanged — the buyer has paid and sees no confirmation at all,
          // which is the worst possible outcome.
          eventCallback: (event: PaddleEventData) => {
            // The event's own name lives on `type`; `data` is the payload and
            // is absent on some events, so it is not where the check goes.
            if (event.type === "checkout.completed") onCompleted?.();
            if (event.type === "checkout.error" || event.type === "checkout.warning") {
              console.error(`[paddle] ${event.type}`, event);
            }
          }
        } as PaddleSetupOptions);
        if (!cancelled) setPaddle(instance);
      } catch (err) {
        // Left uninitialised on purpose; open() reports this message.
        fail(`initialisation failed: ${errorMessage(err)}`, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(
    async ({ priceId, email }: { priceId: string; email?: string }) => {
      if (!(window as unknown as { Paddle?: Paddle }).Paddle) {
        throw new Error("window.Paddle is undefined: paddle.js was not loaded");
      }
      if (!paddle) {
        throw new Error(initError ?? "Paddle is still initialising (client token not received yet)");
      }
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        settings: { displayMode: "overlay", variant: "one-page" },
        ...(email ? { customer: { email } } : {})
      });
    },
    [paddle, initError]
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
      } catch (err) {
        // Leave the static price on screen; it is the same number Paddle bills.
        console.error("[paddle] price preview failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return prices;
}

