import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Clerk needs its own origins allowed for the sign-in widgets and for the
// bot-protection widget it may load. Adding a CSP is only safe if the auth
// pages still render, so these values are verified against the real app, not
// guessed.
//
// Turnstile (the CAPTCHA behind Clerk's bot sign-up protection) is required by
// Clerk's own CSP guidance in script-src, connect-src and frame-src. Without it
// the challenge silently fails and sign-ups die with "failed security
// validations". A bare host does not match its own subdomains in CSP, so both
// forms are listed: Turnstile spins up per-request subdomains (hagen., brunhild.)
// for the verification step.
const turnstile = "https://challenges.cloudflare.com https://*.challenges.cloudflare.com";

// Paddle's overlay checkout. The redirect flow needed none of this; opening a
// checkout in place does: paddle.js is served from cdn.paddle.com and it frames
// the payment page on checkout.paddle.com. Without these the overlay renders
// blank — a silent failure, since the page looks correct until it is opened.
const paddle = "https://cdn.paddle.com https://checkout.paddle.com https://*.paddle.com";
// Origins the browser needs for Clerk's FAPI, WebSocket sessions and JS bundle.
// A dev instance lives on *.clerk.accounts.dev; a live instance lives on
// *.clerk.com. Both have to be allowed: with only the dev origin the app looks
// perfect in development and then, the moment a pk_live_ goes in, the browser
// silently blocks Clerk's script and the sign-in screen does nothing at all.
const clerkHttp = "https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com";
const clerkWs = "wss://*.clerk.accounts.dev wss://*.clerk.com";

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; Turbopack also needs eval in dev.
  // blob: is required because Clerk and Next both spin up workers from blob URLs.
  `script-src 'self' 'unsafe-inline' blob:${isDev ? " 'unsafe-eval'" : ""} ${clerkHttp} ${turnstile} ${paddle}`,
  `worker-src 'self' blob:`,
  `style-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // The AI features call Groq/Tavily from the server only, so the browser never
  // needs them; Clerk does. Paddle's checkout is an overlay loaded into the page
  // (Paddle.js plus its iframe), which is why its origins are allowed here.
  `connect-src 'self' ${clerkHttp} ${clerkWs} ${turnstile} ${paddle}`,
  `frame-src 'self' ${clerkHttp} ${turnstile} ${paddle}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  `form-action 'self' ${clerkHttp}`,
  "object-src 'none'"
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }])
];

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Service worker and the PWA manifest must never be cached by the CDN.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }
    ];
  }
};

export default nextConfig;
