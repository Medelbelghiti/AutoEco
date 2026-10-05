/**
 * Phase 2.4 — identifier rotation and enumeration resistance.
 *
 * Covers the three changes that could not be asserted in Phase 1 because they
 * span a cookie jar, two route handlers and the API-key table:
 *
 *   1. New API keys use the `aek_` prefix, legacy `lgk_` keys keep working.
 *   2. Signup no longer answers 409 for an address that already has an account.
 *   3. Login returns one indistinguishable failure for unknown / locked / wrong.
 *   4. The CSP report sink accepts reports without reflecting the body back.
 *
 * Real DB, real route handlers, mocked `next/headers` cookie jar and mocked
 * `fetch`, so the Paddle API is never contacted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "crypto";
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

const sent: Array<{ to: string; subject: string }> = [];
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (opts: { to: string; subject: string }) => {
      sent.push({ to: opts.to, subject: opts.subject });
      return { ok: true } as never;
    }),
  };
});

vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("{}", { status: 200 }))
);

process.env.AUTH_SECRET = "phase24-auth-secret-0123456789abcdef01234567";
process.env.NEXT_PUBLIC_APP_URL = "https://autoeco.test";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

const EMAIL_DOMAIN = "phase24-";
const NEW_PREFIX = "aek_";
const LEGACY_PREFIX = "lgk_";
const GENERIC_AUTH_ERROR = "Invalid email or password";

type SignupRoute = typeof import("@/app/api/auth/signup/route");
type LoginRoute = typeof import("@/app/api/auth/login/route");
type CspRoute = typeof import("@/app/api/csp-report/route");
type ApiKeys = typeof import("@/lib/api-keys");
type AuthLib = typeof import("@/lib/auth");

runSuite("Phase 2.4 — identifier rotation and enumeration resistance", () => {
  let freePlanId = "";
  let signup: SignupRoute;
  let login: LoginRoute;
  let csp: CspRoute;
  let apiKeys: ApiKeys;
  let auth: AuthLib;

  beforeAll(async () => {
    await ensurePaddleSchema(prisma);
    freePlanId = (await prisma.plan.findFirst({ where: { key: "free" } }))?.id ?? "";
    signup = await import("@/app/api/auth/signup/route");
    login = await import("@/app/api/auth/login/route");
    csp = await import("@/app/api/csp-report/route");
    apiKeys = await import("@/lib/api-keys");
    auth = await import("@/lib/auth");
  });

  beforeEach(() => {
    jar.clear();
    sent.length = 0;
    vi.mocked(fetch).mockClear();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "VerificationToken" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE '${EMAIL_DOMAIN}%@autoeco.test')`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ApiKey" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE '${EMAIL_DOMAIN}%@autoeco.test')`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditLog" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE '${EMAIL_DOMAIN}%@autoeco.test') OR "metadata" LIKE '%[csp-report]%'`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "User" WHERE "email" LIKE '${EMAIL_DOMAIN}%@autoeco.test'`
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "RateLimitEntry" WHERE "key" LIKE 'login:%' OR "key" LIKE 'signup:%' OR "key" LIKE 'csp:%'`);
    await prisma.$disconnect();
  });

  async function makeUser(slug: string, password: string, displayName?: string): Promise<{ id: string; email: string }> {
    const email = `${EMAIL_DOMAIN}${slug}@autoeco.test`;
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash: await auth.hashPassword(password),
        name: displayName ?? slug,
        role: "USER",
        emailVerifiedAt: new Date(),
        planId: freePlanId || null,
      },
      select: { id: true, email: true },
    });
    return u;
  }

  function post(url: string, body: unknown): Request {
    return new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function authRequest(raw: string): Request {
    return new Request("https://autoeco.test/api/reports", {
      headers: { authorization: `Bearer ${raw}` },
    });
  }

  /** CSP reports go through captureEvent, so they land as `error.unhandled`. */
  const cspWhere = { metadata: { contains: "[csp-report]" } };
  function countCsp(): Promise<number> {
    return prisma.auditLog.count({ where: cspWhere });
  }
  function latestCsp() {
    return prisma.auditLog.findFirst({ where: cspWhere, orderBy: { createdAt: "desc" } });
  }

  const SIGNUP_URL = "https://autoeco.test/api/auth/signup";
  const LOGIN_URL = "https://autoeco.test/api/auth/login";

  // --- API key prefix rotation -------------------------------------------

  run("7a. new API keys are issued with the aek_ prefix", async () => {
    const u = await makeUser("keys-new", "phase24-password-1234");

    const k = apiKeys.generateApiKey();
    expect(k.raw.startsWith(NEW_PREFIX)).toBe(true);
    expect(k.raw.startsWith(LEGACY_PREFIX)).toBe(false);
    expect(k.prefix.startsWith(NEW_PREFIX)).toBe(true);

    const created = await prisma.apiKey.create({
      data: { userId: u.id, name: "rotated", prefix: k.prefix, keyHash: k.hash, scopes: '["read"]' },
    });

    const res = await apiKeys.authenticateApiKey(authRequest(k.raw));
    expect(res).not.toBeNull();
    expect(res!.userId).toBe(u.id);
    expect(res!.keyId).toBe(created.id);
    expect(res!.scopes).toEqual(["read"]);
  });

  run("7b. a key issued under the legacy lgk_ prefix still authenticates", async () => {
    const u = await makeUser("keys-legacy", "phase24-password-1234");
    const legacyRaw = `${LEGACY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;

    await prisma.apiKey.create({
      data: {
        userId: u.id,
        name: "legacy",
        prefix: legacyRaw.slice(0, 8),
        keyHash: apiKeys.hashApiKey(legacyRaw),
        scopes: '["read"]',
      },
    });

    // The whole point of the rotation: pre-existing keys must not break.
    const res = await apiKeys.authenticateApiKey(authRequest(legacyRaw));
    expect(res).not.toBeNull();
    expect(res!.userId).toBe(u.id);
  });

  run("7c. a key with an unknown prefix is rejected before any hash lookup", async () => {
    const u = await makeUser("keys-unknown", "phase24-password-1234");
    const unknownRaw = `zzz_${crypto.randomBytes(24).toString("base64url")}`;

    // Stored and unrevoked: only the prefix gate can reject it.
    await prisma.apiKey.create({
      data: {
        userId: u.id,
        name: "unknown",
        prefix: "zzz_",
        keyHash: apiKeys.hashApiKey(unknownRaw),
        scopes: '["read"]',
      },
    });

    expect(await apiKeys.authenticateApiKey(authRequest(unknownRaw))).toBeNull();
    expect(await apiKeys.authenticateApiKey(authRequest("no-prefix-at-all"))).toBeNull();
    expect(await apiKeys.authenticateApiKey(new Request("https://autoeco.test/api/x"))).toBeNull();
  });

  run("7d. a revoked key stops working under either prefix", async () => {
    const u = await makeUser("keys-revoked", "phase24-password-1234");
    const legacyRaw = `${LEGACY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
    const row = await prisma.apiKey.create({
      data: {
        userId: u.id,
        name: "revoked",
        prefix: legacyRaw.slice(0, 8),
        keyHash: apiKeys.hashApiKey(legacyRaw),
        scopes: '["read"]',
        revokedAt: new Date(),
      },
    });
    expect(row.revokedAt).not.toBeNull();
    expect(await apiKeys.authenticateApiKey(authRequest(legacyRaw))).toBeNull();
  });

  // --- Signup enumeration -------------------------------------------------

  run("8a. signup for an address that already exists no longer answers 409", async () => {
    const existing = await makeUser("dup", "phase24-password-1234");

    const res = await signup.POST(
      post(SIGNUP_URL, {
        email: existing.email,
        password: "attacker-password-9999",
        name: "Attacker",
      }),
      undefined
    );

    // 200, not 409: the status code alone no longer confirms the address.
    expect(res.status).toBe(200);

    const fresh = await signup.POST(
      post(SIGNUP_URL, {
        email: `${EMAIL_DOMAIN}brandnew@autoeco.test`,
        password: "phase24-password-1234",
        name: "Brand New",
      }),
      undefined
    );
    expect(fresh.status).toBe(200);
  });

  run("8b. a duplicate signup leaks neither the id nor the real name", async () => {
    const OWNER_NAME = "Owner's Real Display Name";
    const existing = await makeUser("leaky", "phase24-password-1234", OWNER_NAME);

    const res = await signup.POST(
      post(SIGNUP_URL, {
        email: existing.email,
        password: "attacker-password-9999",
        name: "Attacker",
      }),
      undefined
    );

    const raw = await res.text();
    const body = JSON.parse(raw) as { user: Record<string, unknown> };

    expect(raw).not.toContain(existing.id);
    // The owner's display name is PII and is not derivable from what was posted.
    expect(raw).not.toContain(OWNER_NAME);
    expect(raw).not.toContain("Owner's");

    // Key set matches the success payload so the shape is not an oracle.
    expect(Object.keys(body).sort()).toEqual(["trialActive", "user"]);
    expect(Object.keys(body.user).sort()).toEqual(["email", "id", "name", "role"]);
    // A real account id is a non-empty cuid, so an empty string would itself
    // confirm the address is taken.
    expect(typeof body.user.id).toBe("string");
    expect((body.user.id as string).length).toBeGreaterThan(10);
  });

  run("8c. a duplicate signup creates no second user and no new session", async () => {
    const existing = await makeUser("nodupe", "phase24-password-1234");
    const before = await prisma.user.count({ where: { email: existing.email } });

    await signup.POST(
      post(SIGNUP_URL, {
        email: existing.email,
        password: "attacker-password-9999",
      }),
      undefined
    );

    expect(await prisma.user.count({ where: { email: existing.email } })).toBe(before);
    // Critically: the attacker must not be handed a usable session cookie.
    const issued = [...jar.entries()].filter(([, v]) => v.length > 20);
    expect(issued).toHaveLength(0);
  });

  run("8d. the existing owner is told someone tried to use their address", async () => {
    const existing = await makeUser("notify", "phase24-password-1234");

    await signup.POST(
      post(SIGNUP_URL, {
        email: existing.email,
        password: "attacker-password-9999",
      }),
      undefined
    );

    const notice = sent.find((m) => m.to === existing.email);
    expect(notice).toBeDefined();
    expect(notice!.subject).toContain("sign up with your email");
  });

  // --- Login enumeration --------------------------------------------------

  run("9a. unknown email, wrong password and locked account are indistinguishable", async () => {
    const wrongPw = await makeUser("wrongpw", "phase24-password-1234");
    const locked = await makeUser("locked", "phase24-password-1234");
    await prisma.user.update({
      where: { id: locked.id },
      data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedLoginAttempts: 8 },
    });

    const unknownRes = await login.POST(
      post(LOGIN_URL, { email: `${EMAIL_DOMAIN}nobody@autoeco.test`, password: "phase24-password-1234" }),
      undefined
    );
    const wrongRes = await login.POST(
      post(LOGIN_URL, { email: wrongPw.email, password: "wrong-password-0000" }),
      undefined
    );
    const lockedRes = await login.POST(
      post(LOGIN_URL, { email: locked.email, password: "phase24-password-1234" }),
      undefined
    );

    // Same status, same body, byte for byte.
    expect(unknownRes.status).toBe(401);
    expect(wrongRes.status).toBe(401);
    expect(lockedRes.status).toBe(401);

    const [unknownBody, wrongBody, lockedBody] = await Promise.all([
      unknownRes.text(),
      wrongRes.text(),
      lockedRes.text(),
    ]);
    expect(lockedBody).toBe(unknownBody);
    expect(wrongBody).toBe(unknownBody);
    expect(unknownBody).toContain(GENERIC_AUTH_ERROR);
  });

  run("9b. the lockout itself is still enforced, just not advertised", async () => {
    const u = await makeUser("lockout", "phase24-password-1234");
    await prisma.user.update({
      where: { id: u.id },
      data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedLoginAttempts: 8 },
    });
    const url = post(LOGIN_URL, { email: u.email, password: "phase24-password-1234" });

    // Correct password while locked: refused, and the account stays locked.
    const res = await login.POST(url, undefined);
    expect(res.status).toBe(401);
    const row = await prisma.user.findUnique({ where: { id: u.id } });
    expect(row!.lockedUntil).not.toBeNull();

    // Once the lock expires the same correct password succeeds.
    await prisma.user.update({
      where: { id: u.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const ok = await login.POST(post(LOGIN_URL, { email: u.email, password: "phase24-password-1234" }), undefined);
    expect(ok.status).toBe(200);
  });

  run("9c. repeated failures trip the lockout without ever naming the reason", async () => {
    const u = await makeUser("bruteforce", "phase24-password-1234");
    let last = "";
    for (let i = 0; i < 8; i += 1) {
      const res = await login.POST(post(LOGIN_URL, { email: u.email, password: "wrong-password-0000" }), undefined);
      expect(res.status).toBe(401);
      last = await res.text();
    }
    expect(last).toContain(GENERIC_AUTH_ERROR);
    expect(last).not.toContain("locked");

    const row = await prisma.user.findUnique({ where: { id: u.id } });
    expect(row!.lockedUntil).not.toBeNull();
    expect(row!.failedLoginAttempts).toBeGreaterThanOrEqual(8);
  });

  run("9d. a deleted account is reported exactly like an unknown one", async () => {
    const u = await makeUser("deleted", "phase24-password-1234");
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });

    const res = await login.POST(
      post(LOGIN_URL, { email: u.email, password: "phase24-password-1234" }),
      undefined
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toContain(GENERIC_AUTH_ERROR);
  });

  // --- CSP report sink ----------------------------------------------------

  run("10a. a report-uri payload is stored and never echoed back", async () => {
    const payload = {
      "csp-report": {
        "document-uri": "https://autoeco.test/dashboard",
        "violated-directive": "script-src",
        "blocked-uri": "https://cdn.example.invalid/evil.js",
      },
    };
    const before = await countCsp();

    const res = await csp.POST(
      new Request("https://autoeco.test/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "x-forwarded-for": "198.51.100.7",
        },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const after = await countCsp();
    expect(after).toBe(before + 1);

    const row = await latestCsp();
    expect(row!.metadata).toContain("script-src");
    expect(row!.metadata).toContain("blocked-uri");
    expect(row!.action).toBe("error.unhandled");
    // The reporting IP is recorded for abuse investigation.
    expect(row!.ip).toBe("198.51.100.7");
  });

  run("10b. a Reporting API csp-violation batch is accepted", async () => {
    const before = await countCsp();
    const res = await csp.POST(
      new Request("https://autoeco.test/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/reports+json" },
        body: JSON.stringify([
          {
            type: "csp-violation",
            body: {
              "documentURL": "https://autoeco.test/pricing",
              "effectiveDirective": "frame-src",
              "blockedURL": "https://evil.example.invalid",
            },
          },
        ]),
      })
    );
    expect(res.status).toBe(204);
    expect(await countCsp()).toBe(before + 1);
  });

  run("10c. junk and unparsable bodies are answered without being persisted", async () => {
    const before = await countCsp();

    const junk = await csp.POST(
      new Request("https://autoeco.test/api/csp-report", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not a report at all",
      })
    );
    const broken = await csp.POST(
      new Request("https://autoeco.test/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/reports+json" },
        body: "{not json",
      })
    );

    expect(junk.status).toBe(204);
    expect(broken.status).toBe(204);
    expect(await countCsp()).toBe(before);
  });

  run("10e. the sink is rate limited so it cannot be used to flood the audit log", async () => {
    const req = () =>
      new Request("https://autoeco.test/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "x-forwarded-for": "203.0.113.9",
        },
        body: JSON.stringify({ "csp-report": { "violated-directive": "script-src" } }),
      });

    const before = await countCsp();
    let accepted = 0;
    let throttled = 0;
    for (let i = 0; i < 70; i += 1) {
      const res = await csp.POST(req());
      if (res.status === 204) accepted += 1;
      if (res.status === 429) throttled += 1;
    }

    expect(accepted).toBeGreaterThan(0);
    expect(throttled).toBeGreaterThan(0);
    const after = await countCsp();
    expect(after - before).toBeLessThanOrEqual(60);
  });

  run("10d. an oversized body is truncated, not stored whole", async () => {
    const res = await csp.POST(
      new Request("https://autoeco.test/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: JSON.stringify({ "csp-report": { pad: "A".repeat(9000) } }),
      })
    );
    expect(res.status).toBe(204);

    const row = await latestCsp();
    // The stored message is capped by the error-capture scrubber.
    const stored = (JSON.parse(row!.metadata!) as { message: string }).message;
    expect(stored.length).toBeLessThanOrEqual(300);
    expect(stored.length).toBeLessThan(9000);
  });
});