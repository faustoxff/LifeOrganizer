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