import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/session-cookie";
import { siteOrigin } from "@/lib/seo";

/**
 * POST-only logout.
 *
 * The session is cleared exactly as `destroySession()` does today, then the
 * browser is sent to `/login` with a 303 so it follows up with a GET. The old
 * `{ ok: true }` body is what dumped raw JSON onto the page: the sidebar and
 * mobile-nav logouts are plain HTML forms, so the browser navigated straight
 * to this route.
 *
 * The clearing cookies are also written onto the redirect response itself.
 * `expires` is set explicitly alongside `maxAge: 0`: Next merges the
 * `cookies().set()` mutations from `destroySession()` into the returned
 * response and, in doing so, re-serializes the Set-Cookie through
 * `@edge-runtime/cookies`, which DROPS `Max-Age=0` on parse. An explicit past
 * `Expires` survives that round-trip, so the cookie is actually expired on the
 * wire (proven against a real production server) rather than merely blanked.
 *
 * GET is rejected with 405 on purpose: a logout must never be triggerable by a
 * link, `<img>` or prefetch, which would be a CSRF vector.
 */
export const POST = async () => {
  destroySession();

  const res = NextResponse.redirect(new URL("/login", siteOrigin()), 303);
  const clear = { httpOnly: true, path: "/", maxAge: 0, expires: new Date(0) } as const;
  res.cookies.set(SESSION_COOKIE, "", clear);
  res.cookies.set(LEGACY_SESSION_COOKIE, "", clear);
  return res;
};

export const GET = () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });
