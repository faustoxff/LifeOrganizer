import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
// Code only: the comments explain why there is no auth.protect(), and mention it.
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// /pricing is what a payment reviewer or a visitor sees before signing up, so it
// must stay readable without a session — while /plans, where plans are bought,
// must keep requiring one.
describe("public pricing", () => {
  it("/pricing does not require a session", () => {
    const source = code("app/pricing/page.tsx");
    expect(source).not.toMatch(/auth\.protect|requireAuth|AuthGate/);
  });

  it("/plans still requires a session", () => {
    expect(code("app/plans/page.tsx")).toMatch(/auth\.protect\(\)/);
  });

  it("is in the sitemap and linked from the footer links", () => {
    expect(read("app/sitemap.ts")).toContain('"/pricing"');
    expect(read("components/legal/legal-links.tsx")).toContain('href="/pricing"');
  });

  it("is not blocked for crawlers", () => {
    expect(read("app/robots.ts")).not.toMatch(/disallow:[^\]]*\/pricing/);
  });

  it("shares the plan list with /plans instead of duplicating prices", () => {
    expect(read("components/pricing-page.tsx")).toContain("PlanCards");
    expect(read("components/plans-page.tsx")).toContain("PlanCards");
    expect(code("components/pricing-page.tsx")).not.toMatch(/LEGAL\.prices|US\$/);
  });
});
