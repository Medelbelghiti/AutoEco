/**
 * Profile locale preference — the DB-backed guarantee behind the language
 * selector.
 *
 * The settings screen persists the chosen `locale` onto the user's profile,
 * the route accepts exactly the shipped locales (nothing a register could not
 * hold), and a pending locale is rejected as a stored value because `ar` must
 * not become a durable setting while it still renders English.
 *
 * Real DB, real route handler, mocked `next/headers` cookie jar — no HTTP
 * server involved.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";
import { ensurePdfReportSchema } from "./_ensureSchema";
import { LOCALES, READY_LOCALES, effectiveLocale } from "@/lib/i18n";

const prisma = new PrismaClient();
const stamp = `locale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "profile-locale-auth-secret-0123456789abcdef";
process.env.NEXT_PUBLIC_APP_URL = "https://autoeco.test";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Profile locale persistence (real DB)", () => {
  let auth: typeof import("@/lib/auth");
  let route: typeof import("@/app/api/profile/route");

  beforeAll(async () => {
    await ensurePdfReportSchema(prisma);
    auth = await import("@/lib/auth");
    route = await import("@/app/api/profile/route");
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

  async function makeUser(slug: string, locale?: string) {
    const user = await prisma.user.create({
      data: {
        email: `${stamp}-${slug}@autoeco.test`,
        passwordHash: "x",
        name: slug,
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
        ...(locale ? { locale } : {}),
      },
    });
    return user;
  }

  run("PATCH stores a ready locale on the profile", async () => {
    const user = await makeUser("set-ready", "fr");
    await auth.createSession(user.id);

    const res = await route.PATCH(
      new Request("https://autoeco.test/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ locale: "es" }),
        headers: { "content-type": "application/json" },
      }),
      undefined
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locale).toBe("es");

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.locale).toBe("es");
  });

  run("GET returns the locale that was persisted", async () => {
    const user = await makeUser("get-ready", "pt-BR");
    await auth.createSession(user.id);

    const res = await route.GET(new Request("https://autoeco.test/api/profile"), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locale).toBe("pt-BR");
  });

  run("a pending locale (ar) is rejected as a stored value", async () => {
    const user = await makeUser("reject-pending");
    await auth.createSession(user.id);

    const res = await route.PATCH(
      new Request("https://autoeco.test/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ locale: "ar" }),
        headers: { "content-type": "application/json" },
      }),
      undefined
    );
    expect([400, 422]).toContain(res.status);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.locale ?? null).not.toBe("ar");
  });

  run("an unshipped locale string is rejected", async () => {
    const user = await makeUser("reject-junk");
    await auth.createSession(user.id);

    const res = await route.PATCH(
      new Request("https://autoeco.test/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ locale: "xx-XX" }),
        headers: { "content-type": "application/json" },
      }),
      undefined
    );
    expect([400, 422]).toContain(res.status);
  });

  run("every locale LOCs goes through LOCALE_STATUS cleanly", async () => {
    // The shipped set and the ready set stay in sync with what the schema
    // accepts: anything the route can store must have a defined handling.
    for (const loc of LOCALES) {
      const eff = effectiveLocale(loc);
      expect(READY_LOCALES).toContain(eff);
      expect(READY_LOCALES).not.toContain("ar");
    }
  });
});