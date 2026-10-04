/**
 * Edge middleware — runs before every matched request.
 *
 * Scope is deliberately narrow. The authoritative authorization decision is
 * still `requireUser()` / `requireAdmin()` in `src/lib/auth.ts` and in each
 * route handler, because only those can consult the database (middleware
 * cannot reach Prisma on the edge runtime). This layer exists to:
 *
 *   1. Fail fast — an unauthenticated visitor never reaches the app's pages
 *      or its data-fetching server components at all.
 *   2. Set security headers uniformly, including on responses that never
 *      touch a layout.
 *
 * It must never be the ONLY thing protecting a resource.
 */
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "lg_session";

/** Public auth pages that a signed-in user has no reason to see. */
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password"];

/**
 * Routes reachable without a session (matched as prefixes).
 *
 * `/` must be listed explicitly: without it every anonymous visitor is bounced
 * from the landing page to /login, which kills the entire acquisition funnel.
 * Note the matching rule below treats `/` as an exact match only, so it does
 * not accidentally open up other top-level routes.
 *
 * `/onboarding` is deliberately absent: it lives in the `(app)` route group,
 * whose layout requires a session. The layout is the real guard — the
 * middleware entry would only defeat fail-fast and add a pointless database
 * round-trip on the way to the redirect.
 */
const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/share",
  "/pricing",
  "/api/",
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
  "/affiliate-terms",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Security headers applied to every response. */
function applySecurityHeaders(res: NextResponse, isProd: boolean): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-DNS-Prefetch-Control", "on");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  // Receipts are opened in a new tab from the app; the default isolation is
  // stricter than we need for our own pages but costs nothing.
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isProd) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const isProd = process.env.NODE_ENV === "production";

  // --- Session verification (edge-safe: HMAC JWT, no database access). ---
  let signedIn = false;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const secret = process.env.AUTH_SECRET ?? "";
    if (secret.length >= 32) {
      try {
        await jwtVerify(token, new TextEncoder().encode(secret));
        signedIn = true;
      } catch {
        signedIn = false;
      }
    }
  }

  // --- 1. Send signed-in users away from the auth pages.
  if (signedIn && AUTH_PAGES.includes(pathname)) {
    return applySecurityHeaders(NextResponse.redirect(new URL("/dashboard", req.url)), isProd);
  }

  // --- 2. Fail fast on unauthenticated app routes.
  //
  // `/api/*` is excluded on purpose: API routes carry their own
  // authorization and must return JSON 401s, not an HTML redirect.
  if (!signedIn && !isPublic(pathname) && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Remember where they were headed so login can bounce them back. `/` is
    // public by this point, so there is always a real destination to record.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return applySecurityHeaders(NextResponse.redirect(url), isProd);
  }

  // --- 3. Flag legacy/missing cookie so pages can react if needed, then
  // ---    continue with the standard response including security headers.
  const res = NextResponse.next();
  if (!signedIn && token) {
    // A stale or tampered cookie: clear it so the browser stops sending it.
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return applySecurityHeaders(res, isProd);
}

export const config = {
  matcher: [
    // Everything except static assets and the framework's own files.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|uploads/).*)",
  ],
};