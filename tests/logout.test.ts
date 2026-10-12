/**
 * Logout — the redirect contract, against a real database.
 *
 * The bug this pins: both logout forms (desktop sidebar and mobile nav) are
 * plain HTML `<form method="post" action="/api/auth/logout">`, so the browser
 * navigates to the route and renders whatever it returns. The old handler
 * returned `{ ok: true }`, leaving the user staring at raw JSON.
 *
 * The regression guards:
 *   - a POST clears the session and 303-redirects to `/login` on the app's own
 *     origin (never a user-supplied destination),
 *   - the clearing Set-Cookie is present on the redirect response itself,
 *   - a GET is refused with 405 (no CSRF logout via a link or image),
 *   - and once the cookie is cleared, a protected route stops serving.
 *
 * Real DB, real route handlers, mocked `next/headers` cookie jar — the same
 * pattern as `auth-hardening.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();
const stamp = `logout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "logout-auth-secret-0123456789abcdef0123456789";
process.env.NEXT_PUBLIC_APP_URL = "https://autoeco.test";

const APP_ORIGIN = "https://autoeco.test";
const SESSION_COOKIE = "autoeco_session";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Logout (real DB)", () => {
  let auth: typeof import("@/lib/auth");
  let logout: typeof import("@/app/api/auth/logout/route");
  let profile: typeof import("@/app/api/profile/route");

  beforeAll(async () => {
    auth = await import("@/lib/auth");
    logout = await import("@/app/api/auth/logout/route");
    profile = await import("@/app/api/profile/route");
  });

  beforeEach(() => {
    jar.clear();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "User" WHERE "email" LIKE '${stamp}-%@autoeco.test'`
    );
    await prisma.$disconnect();
  });

  async function signIn(): Promise<string> {
    const plan = await prisma.plan.findFirst({ where: { key: "free" } });
    const user = await prisma.user.create({
      data: {
        email: `${stamp}-${Math.random().toString(36).slice(2, 8)}@autoeco.test`,
        passwordHash: "x",
        name: "Logout Test",
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
        ...(plan ? { planId: plan.id } : {}),
      },
    });
    await auth.createSession(user.id);
    return user.id;
  }

  function postLogout() {
    // The handler takes no arguments (it ignores the request entirely).
    return logout.POST();
  }

  run("POST responds 303 to /login on the app's own origin", async () => {
    await signIn();

    const res = await postLogout();
    expect(res.status).toBe(303);

    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const loc = new URL(location!);
    // Canonical app origin — never the request's Host, never a `next=` param.
    expect(loc.origin).toBe(APP_ORIGIN);
    expect(loc.pathname).toBe("/login");
    expect(loc.search).toBe("");
  });

  run("the redirect response clears the session cookie", async () => {
    await signIn();

    const res = await postLogout();
    const setCookies = res.headers.getSetCookie();
    const session = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(
      session,
      `expected a Set-Cookie clearing ${SESSION_COOKIE}, got ${JSON.stringify(setCookies)}`
    ).toBeTruthy();
    // Empty value, and expired on the wire (Max-Age=0 and/or a past Expires).
    expect(session).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(session).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Path=\//i);
  });

  run("GET is refused with 405 and does not clear the session", async () => {
    const userId = await signIn();

    const res = await logout.GET!();
    expect(res.status).toBe(405);
    // A GET must not log the visitor out: the session is still valid.
    expect(await auth.getSessionUserId()).toBe(userId);
  });

  run("a protected route stops serving once the cookie is cleared", async () => {
    const userId = await signIn();

    // Sanity check: the session really does open the door first.
    const before = await profile.GET(new Request(`${APP_ORIGIN}/api/profile`), undefined);
    expect(before.status).toBe(200);
    expect((await before.json()).id).toBe(userId);

    await postLogout();

    const after = await profile.GET(new Request(`${APP_ORIGIN}/api/profile`), undefined);
    expect([401, 403]).toContain(after.status);
  });
});
