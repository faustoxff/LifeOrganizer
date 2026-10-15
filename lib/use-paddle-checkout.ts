"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";
import { paddleEnvironmentName } from "@/lib/paddle-config";

/**
 * Paddle's overlay checkout.
 *
 * Opens the payment page in place instead of redirecting to it, so a buyer who
 * closes the modal is still on the plans page with the trial state intact.
 *
 * Deliberately not here:
 *  - The API key. Paddle.js is initialised with the public client-side token
 *    (`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`), which is scoped to opening checkouts
 *    and reading prices. The server API key never reaches the browser.
 *  - Access to anything. `checkout.completed` only closes the overlay and shows
 *    a message; the plan is granted by the verified webhook, never by the
 *    client.
 *  - Price arithmetic. Paddle decides what the buyer pays in their own currency.
 */

// One initialisation per page, however many components ask. `initializePaddle`
// loads paddle.js itself; calling it twice would register two event callbacks.
let paddlePromise: Promise<Paddle | undefined> | null = null;
let onCompletedRef: (() => void) | null = null;

function getPaddle(): Promise<Paddle | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  if (!token) return Promise.resolve(undefined);

  paddlePromise ??= initializePaddle({
    // Without this a sandbox token is sent to the production endpoint.
    environment: paddleEnvironmentName(),
    token,
    eventCallback: (event: PaddleEventData) => {
      // TODO(verificar): paddle-js's types put the event name on `name` (and
      // `type` is a separate field); the earlier code read `type`. Both are
      // accepted until a sandbox purchase confirms which one fires.
      if (event.name === "checkout.completed" || event.type === "checkout.completed") {
        // Close the overlay ourselves so the confirmation message is visible.
        window.Paddle?.Checkout.close();
        onCompletedRef?.();
      }
    }
  }).catch(() => undefined);
  return paddlePromise;
}

export function usePaddleCheckout(onCompleted?: () => void): {
  open: (params: { priceId: string; email?: string; userId?: string }) => Promise<void>;
  ready: boolean;
} {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;

  useEffect(() => {
    let cancelled = false;
    const handler = () => completedRef.current?.();
    onCompletedRef = handler;
    void getPaddle().then((instance) => {
      if (instance && !cancelled) setPaddle(instance);
    });
    return () => {
      cancelled = true;
      if (onCompletedRef === handler) onCompletedRef = null;
    };
  }, []);

  const open = useCallback(
    async ({ priceId, email, userId }: { priceId: string; email?: string; userId?: string }) => {
      if (!paddle) throw new Error("checkout_not_ready");
      await paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        settings: { displayMode: "overlay", variant: "one-page" },
        ...(email ? { customer: { email } } : {}),
        // Ties the purchase to the signed-in account. The webhook reads
        // `custom_data.user_id`; it is a hint, and the webhook still decides.
        ...(userId ? { customData: { user_id: userId } } : {})
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

