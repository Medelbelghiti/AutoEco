/**
 * Delete expense — the real `DELETE` contract, against a real database.
 *
 * The bug this pins: the edit page submitted a plain HTML form to
 * `/api/expenses/{id}` with a hidden `_method=DELETE`. The route only exports
 * `GET`, `PATCH` and `DELETE`, so the browser POST received a 405 and the
 * expense was never removed. The page now issues a real `DELETE` request.
 *
 * The regression guards:
 *   - the owner's DELETE removes the row,
 *   - another signed-in user gets 403 and the row survives,
 *   - an anonymous request gets 401 and the row survives.
 *
 * Real DB, real route handler, mocked `next/headers` cookie jar — the same
 * pattern as `logout.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();
const stamp = `expdel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "expense-delete-secret-0123456789abcdef012345";
process.env.NEXT_PUBLIC_APP_URL = "https://autoeco.test";

const APP_ORIGIN = "https://autoeco.test";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Delete expense (real DB)", () => {
  let auth: typeof import("@/lib/auth");
  let route: typeof import("@/app/api/expenses/[id]/route");
  let freePlanId: string | null = null;

  beforeAll(async () => {
    const free = await prisma.plan.findFirst({ where: { key: "free" } });
    freePlanId = free?.id ?? null;
    auth = await import("@/lib/auth");
    route = await import("@/app/api/expenses/[id]/route");
  });

  beforeEach(() => {
    jar.clear();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" LIKE '${stamp}-%@autoeco.test'`);
    await prisma.$disconnect();
  });

  async function makeUser(slug: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `${stamp}-${slug}@autoeco.test`,
        passwordHash: "x",
        name: slug,
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
        ...(freePlanId ? { planId: freePlanId } : {}),
      },
    });
    return user.id;
  }

  async function makeExpense(userId: string): Promise<string> {
    const vehicle = await prisma.vehicle.create({
      data: { userId, brand: "Test", model: "Car", year: 2020 },
    });
    const expense = await prisma.expense.create({
      data: {
        userId,
        vehicleId: vehicle.id,
        category: "fuel",
        amountCents: 2500,
        currency: "USD",
        date: new Date(),
      },
    });
    return expense.id;
  }

  function del(id: string) {
    return route.DELETE(new Request(`https://autoeco.test/api/expenses/${id}`, { method: "DELETE" }), {
      params: { id },
    });
  }

  it("the owner's DELETE removes the expense", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("owner");
    const id = await makeExpense(owner);
    await auth.createSession(owner);

    const res = await del(id);
    expect(res.status).toBe(200);
    expect(await prisma.expense.findUnique({ where: { id } })).toBeNull();
  });

  it("another user cannot delete it (403) and the row survives", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("victim");
    const other = await makeUser("intruder");
    const id = await makeExpense(owner);

    await auth.createSession(other);
    const res = await del(id);
    expect(res.status).toBe(403);
    expect(await prisma.expense.findUnique({ where: { id } })).not.toBeNull();
  });

  it("an anonymous request (401) leaves the row intact", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("anon");
    const id = await makeExpense(owner);

    const res = await del(id);
    expect(res.status).toBe(401);
    expect(await prisma.expense.findUnique({ where: { id } })).not.toBeNull();
  });
});
