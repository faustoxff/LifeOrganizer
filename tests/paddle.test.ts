import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planForPriceId, toSubscriptionStatus } from "@/lib/paddle";

// Three things here decide whether a paying customer keeps access, and all
// three are cheap to get wrong in a way that only shows up months later: a
// status that drops the plan on a failed card, a price that no longer maps to a
// tier, or a mapping that invents a plan nobody bought.

describe("toSubscriptionStatus", () => {
  it("keeps access for a paid or trialing subscription", () => {
    expect(toSubscriptionStatus("active")).toBe("authorized");
    expect(toSubscriptionStatus("trialing")).toBe("authorized");
  });

  it("keeps the plan through a failed card", () => {
    // Paddle retries a dunning payment on its own. Revoking on the first
    // failure takes a working customer's access away over one declined card.
    expect(toSubscriptionStatus("past_due")).toBe("paused");
  });

  it("revokes on a pause, because a paused subscription bills nothing", () => {
    expect(toSubscriptionStatus("paused")).toBe("cancelled");
  });

  it("revokes only once a cancellation has actually taken effect", () => {
    // Cancelling mid-period leaves status at "active" with a scheduledChange;
    // the flip to "canceled" arrives when service really ends.
    expect(toSubscriptionStatus("canceled")).toBe("cancelled");
  });

  it("returns null for a status it does not recognise", () => {
    // A new status from Paddle must not be guessed at; the caller leaves the
    // subscription alone until someone has thought about what it means.
    expect(toSubscriptionStatus("something-new" as never)).toBeNull();
  });
});

describe("planForPriceId", () => {
  beforeEach(() => {
    process.env.PADDLE_PRICE_PLUS = "pri_plus";
    process.env.PADDLE_PRICE_PRO = "pri_pro";
  });

  afterEach(() => {
    delete process.env.PADDLE_PRICE_PLUS;
    delete process.env.PADDLE_PRICE_PRO;
  });

  it("maps each price to its tier", () => {
    expect(planForPriceId("pri_plus")).toBe("plus");
    expect(planForPriceId("pri_pro")).toBe("pro");
  });

  it("returns null for a price that is not one of ours", () => {
    // Handing someone Pro they never paid for is worse than not attributing
    // the payment at all.
    expect(planForPriceId("pri_someone_elses")).toBeNull();
    expect(planForPriceId(undefined)).toBeNull();
  });

  it("returns null when the prices are not configured", () => {
    delete process.env.PADDLE_PRICE_PLUS;
    delete process.env.PADDLE_PRICE_PRO;
    expect(planForPriceId("pri_plus")).toBeNull();
  });
});
import { priceIdFor, webhookSecret, paddleEnvironmentName } from "@/lib/paddle-config";

describe("paddle-config", () => {
  const keys = [
    "NEXT_PUBLIC_PADDLE_PRICE_PLUS",
    "NEXT_PUBLIC_PADDLE_PRICE_PRO",
    "PADDLE_PRICE_PLUS",
    "PADDLE_PRICE_PRO",
    "PADDLE_WEBHOOK_SECRET",
    "PADDLE_NOTIFICATION_WEBHOOK_SECRET",
    "NEXT_PUBLIC_PADDLE_ENV"
  ];
  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it("reads the price ids from the NEXT_PUBLIC variables, which is what the server used to miss", () => {
    process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO = "pri_pro";
    expect(planForPriceId("pri_pro")).toBe("pro");
    expect(priceIdFor("pro")).toBe("pri_pro");
  });

  it("falls back to the legacy server-side names", () => {
    process.env.PADDLE_PRICE_PLUS = "pri_plus_legacy";
    expect(planForPriceId("pri_plus_legacy")).toBe("plus");
  });

  it("never maps an unknown or empty price to a plan", () => {
    process.env.NEXT_PUBLIC_PADDLE_PRICE_PLUS = "pri_plus";
    expect(planForPriceId("pri_other")).toBeNull();
    expect(planForPriceId(undefined)).toBeNull();
    expect(planForPriceId("")).toBeNull();
  });

  it("prefers PADDLE_WEBHOOK_SECRET and accepts the old name as an alias", () => {
    process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET = "old";
    expect(webhookSecret()).toBe("old");
    process.env.PADDLE_WEBHOOK_SECRET = "new";
    expect(webhookSecret()).toBe("new");
  });

  it("defaults to sandbox", () => {
    expect(paddleEnvironmentName()).toBe("sandbox");
    process.env.NEXT_PUBLIC_PADDLE_ENV = "production";
    expect(paddleEnvironmentName()).toBe("production");
  });
});
