import { describe, expect, it } from "vitest";
import { LEGAL } from "@/lib/legal-config";

// Paddle charges in USD, and the landing, /plans and the terms all render
// LEGAL.prices as US$. These are the amounts the Paddle catalog bills, so a
// change here has to be made in the catalog too.
describe("pricing", () => {
  it("advertises the USD amounts Paddle charges", () => {
    expect(LEGAL.prices).toEqual({ plus: 6, pro: 20 });
  });

  it("keeps Pro above Plus", () => {
    expect(LEGAL.prices.pro).toBeGreaterThan(LEGAL.prices.plus);
  });
});
