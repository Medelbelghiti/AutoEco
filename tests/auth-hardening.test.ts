/**
 * Phase 1 — session revocation, account-enumeration resistance and the
 * "never bill a deleted account" guarantee. Real DB, real route handlers.
 *
 * `next/headers` is mocked with an in-memory cookie jar so the real
 * `createSession` / `getCurrentUser` pair can be exercised outside a request
 * scope. `fetch` is mocked: the Paddle API is never contacted.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";
import { ensurePaddleSchema } from "./_ensureSchema";

const prisma = new PrismaClient();

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const emailCalls: Array<{ to: string }> = [];
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (opts: { to: string }) => {
      emailCalls.push({ to: opts.to });
      return { ok: true } as never;
    }),
  };
});

const SESSION_COOKIE = "lg_session";
process.env.AUTH_SECRET = "phase1-auth-secret-0123456789abcdef0123456789";
// `@/lib/env` snapshots process.env at import time, and paddleRequest refuses to
// call the provider at all without an API key. Without this the deletion test
// would 502 before ever reaching fetch, proving nothing about ordering.
process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_phase1_fake";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

type AuthLib = typeof import("@/lib/auth");
let auth: AuthLib;

runSuite("Phase 1 — sessions, enumeration and deletion", () => {
  let freePlanId = "";

  beforeAll(async () => {
    await ensurePaddleSchema(prisma);
    freePlanId = (await prisma.plan.findFirst({ where: { key: "free" } }))?.id ?? "";
    auth = await import("@/lib/auth");
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "VerificationToken" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE 'phase1-%@autoeco.test' OR "email" LIKE 'deleted-%@deleted.invalid')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE 'phase1-%@autoeco.test' OR "email" LIKE 'deleted-%@deleted.invalid')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE 'phase1-%@autoeco.test' OR "email" LIKE 'deleted-%@deleted.invalid')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" LIKE 'phase1-%@autoeco.test' OR "email" LIKE 'deleted-%@deleted.invalid'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "RateLimitEntry" WHERE "key" LIKE 'forgot:%'`);
    await prisma.$disconnect();
  });

  async function makeUser(slug: string, password: string, email?: string): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: email ?? `phase1-${slug}@autoeco.test`,
        passwordHash: await auth.hashPassword(password),
        name: slug,
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
        ...(freePlanId ? { planId: freePlanId } : {}),
      },
    });
    return u.id;
  }

  run("5. change-password revokes previously issued JWTs but keeps this device", async () => {
    const uid = await makeUser("session", "old-password-1234");
    await auth.createSession(uid);
    const oldToken = jar.get(SESSION_COOKIE);
    expect(oldToken).toBeTruthy();

    // The pre-change token works.
    expect((await auth.getCurrentUser())?.id).toBe(uid);

    const { POST } = await import("@/app/api/auth/change-password/route");
    const res = await POST(
      new Request("https://autoeco.test/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "old-password-1234", newPassword: "new-password-5678" }),
      })
    );
    expect(res.status).toBe(200);

    const newToken = jar.get(SESSION_COOKIE);
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);

    // The token minted BEFORE the change is now rejected.
    jar.set(SESSION_COOKIE, oldToken!);
    expect(await auth.getCurrentUser()).toBeNull();

    // The freshly issued one works.
    jar.set(SESSION_COOKIE, newToken!);
    expect((await auth.getCurrentUser())?.id).toBe(uid);

    // And the password really changed.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    expect(await auth.verifyPassword("new-password-5678", row.passwordHash)).toBe(true);
    expect(await auth.verifyPassword("old-password-1234", row.passwordHash)).toBe(false);
  });

  run("5b. reset-password revokes every existing session", async () => {
    const uid = await makeUser("reset", "another-old-pw-99");
    await auth.createSession(uid);
    const oldToken = jar.get(SESSION_COOKIE)!;

    const { randomToken, sha256 } = await import("@/lib/utils");
    const raw = randomToken(24);
    await prisma.verificationToken.create({
      data: {
        userId: uid,
        tokenHash: sha256(raw),
        type: "PASSWORD_RESET",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const { POST } = await import("@/app/api/auth/reset-password/route");
    const res = await POST(
      new Request("https://autoeco.test/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: raw, password: "brand-new-password-42" }),
      })
    );
    expect(res.status).toBe(200);

    // destroySession() cleared the jar...
    jar.set(SESSION_COOKIE, oldToken);
    // ...but even a client that kept the cookie is locked out.
    expect(await auth.getCurrentUser()).toBeNull();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    expect(await auth.verifyPassword("brand-new-password-42", row.passwordHash)).toBe(true);
  });

  run("6. forgot-password is throttled per mailbox and never reveals existence", async () => {
    const existing = `phase1-forgot-${Date.now()}@autoeco.test`;
    // A real row, so the route takes the "user exists" branch.
    await makeUser("forgot", "irrelevant-password-1", existing);

    const missing = `phase1-missing-${Date.now()}@autoeco.test`;
    const { POST } = await import("@/app/api/auth/forgot-password/route");

    const call = (email: string) =>
      POST(
        new Request("https://autoeco.test/api/auth/forgot-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        })
      );

    const bodies: string[] = [];
    // 4 requests for an existing mailbox.
    for (let i = 0; i < 4; i++) {
      const res = await call(existing);
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    // 3 allowed -> exactly 3 reset emails.
    const sentForExisting = emailCalls.filter((c) => c.to === existing).length;
    expect(sentForExisting).toBe(3);

    // A non-existent mailbox: same status, same body shape, no email.
    const before = emailCalls.length;
    const resMissing = await call(missing);
    expect(resMissing.status).toBe(200);
    expect(await resMissing.text()).toBe(bodies[0]);
    expect(emailCalls.length).toBe(before);

    // Response bodies are identical for both branches -> no enumeration.
    expect(new Set(bodies).size).toBe(1);

    const tokens = await prisma.verificationToken.count({
      where: { user: { email: existing }, type: "PASSWORD_RESET", usedAt: null },
    });
    expect(tokens).toBe(3);
  });

  run("7. account deletion cancels Paddle first and aborts if the provider fails", async () => {
    const uid = await makeUser("delete", "delete-me-please-1");
    await prisma.subscription.create({
      data: {
        userId: uid,
        planId: freePlanId,
        status: "active",
        paddleSubscriptionId: "sub_phase1_delete_me",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await auth.createSession(uid);
    const { DELETE } = await import("@/app/api/auth/account/route");
    const req = () =>
      new Request("https://autoeco.test/api/auth/account", { method: "DELETE" });

    const originalFetch = globalThis.fetch;
    let providerCalls: string[] = [];
    let stateAtProviderCall: boolean | null = null;

    try {
      // --- provider fails ---
      globalThis.fetch = (async (url: string) => {
        providerCalls.push(String(url));
        const row = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
        // Capture whether the account was already anonymised at this instant:
        // the provider call must happen BEFORE any mutation.
        stateAtProviderCall = row.deletedAt === null;
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const failed = await DELETE(req());
      expect(failed.status).toBe(502);
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]).toContain("/subscriptions/sub_phase1_delete_me/cancel");
      // Cancelled before anonymisation, and the account survived intact.
      expect(stateAtProviderCall).toBe(true);

      const stillThere = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
      expect(stillThere.deletedAt).toBeNull();
      expect(stillThere.email).toBe(`phase1-delete@autoeco.test`);
      expect(stillThere.paddleCustomerId).toBeNull();

      // --- provider succeeds ---
      providerCalls = [];
      globalThis.fetch = (async (url: string) => {
        providerCalls.push(String(url));
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const done = await DELETE(req());
      expect(done.status).toBe(200);
      expect(providerCalls).toHaveLength(1);

      const gone = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
      expect(gone.deletedAt).not.toBeNull();
      expect(gone.email).toBe(`deleted-${uid}@deleted.invalid`);
      expect(gone.email).toMatch(/@deleted\.invalid$/);
      expect(gone.passwordHash).not.toBe("");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});