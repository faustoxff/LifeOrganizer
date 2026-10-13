/**
 * Pre-release checklist. Prints every known production blocker and exits
 * non-zero if any remain, so shipping with placeholder legal data or a missing
 * webhook secret cannot happen by accident.
 *
 *   npm run check:release
 */
import { readFileSync, existsSync } from "node:fs";
import { LEGAL } from "../lib/legal-config.ts";

const envPath = ".env.local";
const env = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => l.split("=")[0].trim())
  : [];

const blockers = [];
const warnings = [];

// --- Legal pages must not ship with placeholder data -----------------------
for (const field of ["operatorTaxId", "operatorAddress", "contactEmail"]) {
  const value = LEGAL[field];
  // Matches "[DOMICILIO], Argentina" as well as a bare "[CUIT]".
  if (!value || /\[[^\]]+\]/.test(value)) {
    blockers.push(`lib/legal-config.ts: ${field} is still "${value}" — it renders on /terms and /privacy`);
  }
}

// --- Required environment variables ---------------------------------------
const required = ["CLERK_SECRET_KEY", "DATABASE_URL", "GROQ_API_KEY"];
for (const key of required) {
  if (!env.includes(key)) blockers.push(`${key} is not set in ${envPath}`);
}

// A missing webhook secret makes the route return 503, so payments would be
// taken but never activate a plan — the single most expensive thing that can
// be half-configured, because the customer has already been charged.
if (!env.includes("PADDLE_NOTIFICATION_WEBHOOK_SECRET")) {
  blockers.push(
    "PADDLE_NOTIFICATION_WEBHOOK_SECRET is not set — Paddle payments would be taken but never granted"
  );
}
// Without these, createCheckout throws and checkout answers 502: the plans
// page looks fine right up until someone presses the button.
for (const key of ["PADDLE_API_KEY", "PADDLE_PRICE_PLUS", "PADDLE_PRICE_PRO"]) {
  if (!env.includes(key)) blockers.push(`${key} is not set — Plus/Pro checkout cannot be built`);
}
// sitemap.ts, robots.ts and metadataBase all fall back to http://localhost:3000,
// which publishes localhost URLs to search engines and sends checkout back_url
// to the wrong host.
if (!env.includes("NEXT_PUBLIC_SITE_URL")) {
  blockers.push("NEXT_PUBLIC_SITE_URL is not set — sitemap, robots and checkout back_url fall back to localhost");
}
for (const key of ["TAVILY_API_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]) {
  if (!env.includes(key)) warnings.push(`${key} is not set in ${envPath}`);
}

console.log("\nBloqueantes para publicar:");
if (blockers.length === 0) {
  console.log("  ninguno\n");
} else {
  for (const b of blockers) console.log(`  x ${b}`);
  console.log("");
}

if (warnings.length > 0) {
  console.log("Avisos:");
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log("");
}

process.exit(blockers.length > 0 ? 1 : 0);
