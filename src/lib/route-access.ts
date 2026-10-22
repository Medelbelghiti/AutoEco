/**
 * Route classification shared by the edge middleware and its unit tests.
 *
 * The middleware cannot reach the database, so it only fails fast. This module
 * holds the *only* copy of the route taxonomy so the "is this path public /
 * private / non-existent" decision is testable outside the edge runtime.
 */

/** Public auth pages that a signed-in user has no reason to see. */
export const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password"];

/**
 * Routes reachable without a session (matched as prefixes).
 *
 * `/` must be listed explicitly: without it every anonymous visitor is bounced
 * from the landing page to /login, which kills the entire acquisition funnel.
 * The matching rule below treats `/` as an exact match only (via the `${p}/`
 * join), so it does not accidentally open up other top-level routes.
 *
 * `/onboarding` is deliberately absent: it lives in the `(app)` route group,
 * whose layout requires a session. The layout is the real guard — the
 * middleware entry would only defeat fail-fast and add a pointless database
 * round-trip on the way to the redirect.
 */
export const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/share",
  "/pricing",
  "/api",
  "/calculators",
  "/features",
  "/docs",
  "/faq",
  "/car-comparison",
  "/car-cost-calculator",
  "/car-depreciation-calculator",
  "/fuel-cost-calculator",
  "/true-cost-of-car",
  "/terms",
  "/privacy",
  "/acceptable-use",
  "/refund-policy",
];

/**
 * Sections of the app that require a session. Anything under these prefixes is
 * redirected to /login for anonymous visitors — a fast fail, never the
 * authoritative check (that is `requireUser()` in each route handler).
 */
export const APP_PREFIXES = [
  "/dashboard",
  "/garage",
  "/expenses",
  "/fuel",
  "/insights",
  "/financial-twin",
  "/scenarios",
  "/reports",
  "/receipts",
  "/assistant",
  "/settings",
  "/onboarding",
  "/trips",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type PageAccess =
  /** Reachable anonymously. */
  | "public"
  /** An auth page (signed-in users are bounced to /dashboard). */
  | "auth"
  /** An app route: anonymous visitors are redirected to /login. */
  | "app"
  /**
   * Not a route at all. The middleware must NOT redirect these to /login:
   * that turned every typo into a login prompt and served a 200-less soft-404
   * chain (307 -> /login?next=...). We let the request through so Next.js
   * renders `not-found.tsx` with a real 404 status.
   */
  | "missing";

export function classifyPagePath(pathname: string): PageAccess {
  if (AUTH_PAGES.includes(pathname)) return "auth";
  if (isPublicPath(pathname)) return "public";
  if (isAppPath(pathname)) return "app";
  return "missing";
}
