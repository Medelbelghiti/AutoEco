import { NextResponse } from "next/server";
import { requireUser, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { withErrorHandling } from "@/lib/http";
import { SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/session-cookie";
import { siteOrigin } from "@/lib/seo";

/**
 * POST /api/auth/logout-all — "Sign out of all devices".
 *
 * Bumps `User.sessionVersion`, which every issued JWT carries as `sv`; a token
 * whose `sv` no longer matches the row is rejected by `getCurrentUser()`. That
 * revokes every other device at once, and clearing the cookie below signs this
 * device out too. The pair is the whole mechanism — no per-session table.
 *
 * GET is refused with 405 so the revocation can never be triggered by a link,
 * `<img>` or prefetch (a CSRF vector): only a POST from the settings page can.
 */
export const POST = withErrorHandling(async () => {
  const user = await requireUser();

  await db.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
  });
  await auditLog({ userId: user.id, action: "auth.logout_all" });

  destroySession();

  const res = NextResponse.redirect(new URL("/login", siteOrigin()), 303);
  const clear = { httpOnly: true, path: "/", maxAge: 0, expires: new Date(0) } as const;
  res.cookies.set(SESSION_COOKIE, "", clear);
  res.cookies.set(LEGACY_SESSION_COOKIE, "", clear);
  return res;
});

export const GET = () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });
