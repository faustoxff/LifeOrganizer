import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Webhooks } from "@paddle/paddle-node-sdk";
import { handlePaddleEvent, type WebhookDeps } from "@/lib/paddle-webhook";
import { decideApply, type SubscriptionSnapshot } from "@/lib/paddle-subscription";
import { paddleHasAccess } from "@/lib/subscription-plans";

// Fixtures follow the shape of Paddle's notification payloads (snake_case).
// TODO(verificar): compare against a real sandbox delivery before going live.
function subscriptionEvent(
  type: string,
  occurredAt: string,
  overrides: Record<string, unknown> = {}
) {
  return Webhooks.fromJson({
    event_id: `evt_${type}_${occurredAt}`,
    event_type: type,
    occurred_at: occurredAt,
    notification_id: "ntf_1",
    data: {
      id: "sub_1",
      status: "active",
      customer_id: "ctm_1",
      address_id: "add_1",
      currency_code: "USD",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: occurredAt,
      items: [{ status: "active", quantity: 1, price: { id: "pri_pro" } }],
      current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
      billing_cycle: { interval: "month", frequency: 1 },
      scheduled_change: null,
      custom_data: { user_id: "user_A" },
      ...overrides
    }
  } as never);
}

type Row = {
  userId: string;
  plan: string;
  snapshot: SubscriptionSnapshot;
};

function makeDeps(initial?: Row) {
  let row: Row | undefined = initial;
  const saves: Row[] = [];
  const deps: WebhookDeps = {
    now: () => new Date("2026-10-15T00:00:00Z"),
    findOwner: async (subId) => (row && row.snapshot.subscriptionId === subId ? row.userId : null),
    getStored: async (userId) =>
      row && row.userId === userId
        ? {
            paddleSubscriptionId: row.snapshot.subscriptionId,
            paddleStatus: row.snapshot.status,
            currentPeriodEnd: row.snapshot.currentPeriodEnd,
            eventAt: row.snapshot.eventAt
          }
        : null,
    save: async (userId, snapshot, plan) => {
      row = { userId, plan, snapshot };
      saves.push(row);
      return true;
    },
    fetchSubscription: vi.fn()
  };
  return { deps, saves, get row() { return row; } };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO = "pri_pro";
  process.env.NEXT_PUBLIC_PADDLE_PRICE_PLUS = "pri_plus";
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO;
  delete process.env.NEXT_PUBLIC_PADDLE_PRICE_PLUS;
});

describe("handlePaddleEvent", () => {
  it("grants the plan for the price on subscription.created", async () => {
    const ctx = makeDeps();
    const outcome = await handlePaddleEvent(subscriptionEvent("subscription.created", "2026-10-01T00:00:00Z"), ctx.deps);
    expect(outcome).toBe("applied");
    expect(ctx.row?.userId).toBe("user_A");
    expect(ctx.row?.plan).toBe("pro");
    expect(ctx.row?.snapshot.currentPeriodEnd?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("is idempotent: the same event twice converges on one state", async () => {
    const ctx = makeDeps();
    const event = subscriptionEvent("subscription.created", "2026-10-01T00:00:00Z");
    await handlePaddleEvent(event, ctx.deps);
    const first = JSON.stringify(ctx.row);
    await handlePaddleEvent(event, ctx.deps);
    expect(JSON.stringify(ctx.row)).toBe(first);
  });

  it("drops an older event that arrives after a newer one (out of order)", async () => {
    const ctx = makeDeps();
    await handlePaddleEvent(subscriptionEvent("subscription.canceled", "2026-10-10T00:00:00Z", { status: "canceled" }), ctx.deps);
    expect(ctx.row?.plan).toBe("free");

    // subscription.updated from BEFORE the cancellation shows up late.
    const outcome = await handlePaddleEvent(subscriptionEvent("subscription.updated", "2026-10-05T00:00:00Z"), ctx.deps);
    expect(outcome).toBe("stale");
    expect(ctx.row?.plan).toBe("free");
    expect(ctx.row?.snapshot.status).toBe("canceled");
  });

  it("keeps the tier on past_due; access is decided at read time", async () => {
    const ctx = makeDeps();
    await handlePaddleEvent(subscriptionEvent("subscription.past_due", "2026-10-12T00:00:00Z", { status: "past_due" }), ctx.deps);
    expect(ctx.row?.plan).toBe("pro");
    expect(ctx.row?.snapshot.status).toBe("past_due");
  });

  it("marks a scheduled cancellation without revoking the plan", async () => {
    const ctx = makeDeps();
    await handlePaddleEvent(
      subscriptionEvent("subscription.updated", "2026-10-12T00:00:00Z", {
        scheduled_change: { action: "cancel", effective_at: "2026-11-01T00:00:00Z", resume_at: null }
      }),
      ctx.deps
    );
    expect(ctx.row?.plan).toBe("pro");
    expect(ctx.row?.snapshot.cancelAtPeriodEnd).toBe(true);
  });

  it("revokes on subscription.canceled", async () => {
    const ctx = makeDeps();
    await handlePaddleEvent(subscriptionEvent("subscription.created", "2026-10-01T00:00:00Z"), ctx.deps);
    await handlePaddleEvent(subscriptionEvent("subscription.canceled", "2026-10-14T00:00:00Z", { status: "canceled" }), ctx.deps);
    expect(ctx.row?.plan).toBe("free");
  });

  it("fails (so Paddle retries) when nobody can be blamed for the purchase", async () => {
    const ctx = makeDeps();
    await expect(
      handlePaddleEvent(subscriptionEvent("subscription.created", "2026-10-01T00:00:00Z", { custom_data: null }), ctx.deps)
    ).rejects.toThrow(/attribute/);
    expect(ctx.saves).toHaveLength(0);
  });

  it("fails rather than guess a tier for a price that is not configured", async () => {
    const ctx = makeDeps();
    await expect(
      handlePaddleEvent(
        subscriptionEvent("subscription.created", "2026-10-01T00:00:00Z", {
          items: [{ status: "active", quantity: 1, price: { id: "pri_unknown" } }]
        }),
        ctx.deps
      )
    ).rejects.toThrow(/not configured/);
    expect(ctx.saves).toHaveLength(0);
  });

  it("trusts the stored owner over custom_data", async () => {
    const ctx = makeDeps();
    await handlePaddleEvent(subscriptionEvent("subscription.created", "2026-10-01T00:00:00Z"), ctx.deps);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handlePaddleEvent(
      subscriptionEvent("subscription.updated", "2026-10-02T00:00:00Z", { custom_data: { user_id: "user_EVIL" } }),
      ctx.deps
    );
    warn.mockRestore();
    expect(ctx.row?.userId).toBe("user_A");
  });

  it("acknowledges events it does not act on", async () => {
    const ctx = makeDeps();
    const event = Webhooks.fromJson({
      event_id: "evt_x", event_type: "customer.updated", occurred_at: "2026-10-01T00:00:00Z", data: { id: "ctm_1" }
    } as never);
    expect(await handlePaddleEvent(event, ctx.deps)).toBe("ignored");
    expect(ctx.saves).toHaveLength(0);
  });

  describe("transaction.completed", () => {
    const txEvent = (subscriptionId: string | null) =>
      Webhooks.fromJson({
        event_id: "evt_tx",
        event_type: "transaction.completed",
        occurred_at: "2026-10-01T00:00:05Z",
        data: { id: "txn_1", status: "completed", subscription_id: subscriptionId, customer_id: "ctm_1", custom_data: { user_id: "user_A" }, items: [], payments: [] }
      } as never);

    it("ignores a one-off payment", async () => {
      const ctx = makeDeps();
      expect(await handlePaddleEvent(txEvent(null), ctx.deps)).toBe("ignored");
      expect(ctx.deps.fetchSubscription).not.toHaveBeenCalled();
    });

    it("reads the subscription from Paddle, so it works even before subscription.created", async () => {
      const ctx = makeDeps();
      (ctx.deps.fetchSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "sub_1", status: "active", customerId: "ctm_1", updatedAt: "2026-10-01T00:00:04Z",
        items: [{ price: { id: "pri_plus" } }],
        currentBillingPeriod: { endsAt: "2026-11-01T00:00:00Z" },
        scheduledChange: null, customData: null
      });
      expect(await handlePaddleEvent(txEvent("sub_1"), ctx.deps)).toBe("applied");
      expect(ctx.row?.plan).toBe("plus");
      expect(ctx.row?.userId).toBe("user_A"); // from the transaction's custom_data
    });
  });
});

describe("decideApply across subscriptions", () => {
  const snap = (id: string, status: SubscriptionSnapshot["status"], end = "2026-11-01T00:00:00Z"): SubscriptionSnapshot => ({
    subscriptionId: id, customerId: "ctm_1", status, priceIds: ["pri_pro"],
    currentPeriodEnd: new Date(end), cancelAtPeriodEnd: false, userId: "user_A",
    eventAt: new Date("2026-10-10T00:00:00Z")
  });
  const stored = (id: string, status: string, end: string) => ({
    paddleSubscriptionId: id, paddleStatus: status, currentPeriodEnd: new Date(end), eventAt: new Date("2026-10-01T00:00:00Z")
  });
  const now = new Date("2026-10-15T00:00:00Z");

  it("lets a new subscription replace one that ended", () => {
    expect(decideApply(stored("sub_old", "canceled", "2026-10-01T00:00:00Z"), snap("sub_new", "active"), now)).toBe("apply");
  });
  it("does not let a second subscription replace a live one", () => {
    expect(decideApply(stored("sub_old", "active", "2026-11-01T00:00:00Z"), snap("sub_new", "active"), now)).toBe("superseded");
  });
  it("ignores a late event of an old subscription", () => {
    expect(decideApply(stored("sub_new", "active", "2026-11-01T00:00:00Z"), snap("sub_old", "canceled"), now)).toBe("superseded");
  });
});

describe("paddleHasAccess", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const future = new Date("2026-10-20T00:00:00Z");
  const past = new Date("2026-10-10T00:00:00Z");
  it.each([
    ["active", null, true],
    ["trialing", null, true],
    ["past_due", future, true],
    ["past_due", past, false],
    ["past_due", null, false],
    ["paused", future, false],
    ["canceled", future, false],
    ["something_new", future, false],
    [null, future, false]
  ])("%s with period end %s -> %s", (status, end, expected) => {
    expect(paddleHasAccess(status, end, now)).toBe(expected);
  });
});
