/**
 * "Sign out of all devices" (Task 5) — real DB.
 *
 * Bumping `User.sessionVersion` must revoke a JWT that another device already
 * holds (its `sv` no longer matches), while the current device is signed out by
 * clearing the cookie. The route is POST-only: a GET is a CSRF vector and must
 * be refused without touching the session.
 *
 * Real route handlers, mocked `next/headers` cookie jar — same pattern as
 * `logout.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();
const stamp = `logout-all-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "logout-all-auth-secret-0123456789abcdef0123";
process.env.NEXT_PUBLIC_APP_URL = "https://autoeco.test";

const APP_ORIGIN = "https://autoeco.test";
const SESSION_COOKIE = "autoeco_session";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Sign out of all devices (real DB)", () => {
  let auth: typeof import("@/lib/auth");
  let logoutAll: typeof import("@/app/api/auth/logout-all/route");
  let profile: typeof import("@/app/api/profile/route");

  beforeAll(async () => {
    auth = await import("@/lib/auth");
    logoutAll = await import("@/app/api/auth/logout-all/route");
    profile = await import("@/app/api/profile/route");
  });

  beforeEach(() => {
    jar.clear();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '${stamp}%')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" LIKE '${stamp}%'`);
    await prisma.$disconnect();
  });

  function post() {
    return logoutAll.POST(new Request(`${APP_ORIGIN}/api/auth/logout-all`, { method: "POST" }), undefined);
  }

  async function newUser(email: string) {
    return prisma.user.create({
      data: { email, passwordHash: "x", currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM" },
    });
  }

  run("POST bumps sessionVersion and 303-redirects to /login on the app origin", async () => {
    const user = await newUser(`${stamp}-main@autoeco.test`);
    await auth.createSession(user.id);
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } })).sessionVersion;

    const res = await post();
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(APP_ORIGIN);
    expect(loc.pathname).toBe("/login");

    const after = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } })).sessionVersion;
    expect(after).toBe(before + 1);
  });

  run("the redirect response clears the session cookie", async () => {
    const user = await newUser(`${stamp}-cookie@autoeco.test`);
    await auth.createSession(user.id);
    const res = await post();
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(session).toBeTruthy();
    expect(session).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(session).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });

  run("revokes a token another device already holds", async () => {
    const user = await newUser(`${stamp}-other@autoeco.test`);
    await auth.createSession(user.id);
    const otherDeviceToken = jar.get(SESSION_COOKIE)!;

    // Sanity: the token works before revocation.
    const before = await profile.GET(new Request(`${APP_ORIGIN}/api/profile`), undefined);
    expect(before.status).toBe(200);

    await post();

    // The other device still presents its old token, but it is now revoked.
    jar.set(SESSION_COOKIE, otherDeviceToken);
    expect(await auth.getCurrentUser()).toBeNull();
    const after = await profile.GET(new Request(`${APP_ORIGIN}/api/profile`), undefined);
    expect([401, 403]).toContain(after.status);
  });

  run("GET is refused with 405 and does not bump sessionVersion", async () => {
    const user = await newUser(`${stamp}-get@autoeco.test`);
    await auth.createSession(user.id);
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } })).sessionVersion;

    const res = await logoutAll.GET!();
    expect(res.status).toBe(405);

    const after = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } })).sessionVersion;
    expect(after).toBe(before);
  });
});
