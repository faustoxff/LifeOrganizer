import { clerkMiddleware } from "@clerk/nextjs/server";

// Auth is enforced with auth.protect() in each protected page and requireAuth()
// in each API route, not by matching paths here. createRouteMatcher() is
// deprecated, and path matching can diverge from how Next.js actually routes a
// request, which is exactly how protected pages end up reachable.
export default clerkMiddleware();

export const config = {
  // The payment webhook is deliberately not in either pattern.
  //
  // Paddle signs the exact bytes of the request body. Clerk's
  // middleware, applied to a request it does not recognise as coming from a
  // signed-in browser, re-reads the body on its way through — and the body that
  // reaches the route is no longer byte-for-byte what the provider signed. The
  // handler then hashes something the sender never hashed and every delivery
  // verifies as forged, which is what happened: real payments were taken and
  // rejected as invalid signatures.
  //
  // The route authenticates with the provider's HMAC instead of a session, so
  // there is nothing for the middleware to do there.
  //
  // A single pattern, not two: this is Clerk's own page pattern with the
  // webhook added to the exclusion list, and it already covers /api and /trpc
  // because those paths do not look like static files. Next.js refuses to parse
  // a second pattern that opens with a lookahead over a literal group.
  matcher: [
    "/((?!api/subscriptions/webhook|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)"
  ]
};
