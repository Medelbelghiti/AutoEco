/**
 * Delete receipt — the real `DELETE` contract, against a real database.
 *
 * The bug this pins: the receipt row rendered a plain HTML form to
 * `/api/documents/{id}` with a hidden `_method=DELETE`. That route exports
 * only `GET` and `DELETE`, so the browser POST received a 405 and the receipt
 * was never removed. The row now issues a real `DELETE` request.
 *
 * Real DB, real route handler, mocked `next/headers` cookie jar. Local storage
 * driver so `deleteFile` touches a throwaway directory.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";
import { join } from "node:path";
import { tmpdir } from "node:os";

// storage.ts captures STORAGE_DIR and the driver at import time; set them
// before the route (and therefore storage.ts) is imported below.
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = join(tmpdir(), `autoeco-receipt-del-${Date.now()}`);

const prisma = new PrismaClient();
const stamp = `recdel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "receipt-del-secret-0123456789abcdef0123456789";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Delete receipt (real DB)", () => {
  let auth: typeof import("@/lib/auth");
  let route: typeof import("@/app/api/documents/[id]/route");

  beforeAll(async () => {
    auth = await import("@/lib/auth");
    route = await import("@/app/api/documents/[id]/route");
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
      },
    });
    return user.id;
  }

  async function makeDocument(userId: string): Promise<string> {
    const doc = await prisma.document.create({
      data: {
        userId,
        title: "Test receipt",
        category: "receipt",
        storageKey: `receipts/${stamp}/${Math.random().toString(36).slice(2, 8)}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1234,
      },
    });
    return doc.id;
  }

  function del(id: string) {
    return route.DELETE(new Request(`https://autoeco.test/api/documents/${id}`, { method: "DELETE" }), {
      params: { id },
    });
  }

  it("the owner's DELETE removes the document", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("owner");
    const id = await makeDocument(owner);
    await auth.createSession(owner);

    const res = await del(id);
    expect(res.status).toBe(200);
    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
  });

  it("another user cannot delete it (403) and the row survives", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("victim");
    const other = await makeUser("intruder");
    const id = await makeDocument(owner);

    await auth.createSession(other);
    const res = await del(id);
    expect(res.status).toBe(403);
    expect(await prisma.document.findUnique({ where: { id } })).not.toBeNull();
  });

  it("an anonymous request (401) leaves the row intact", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("anon");
    const id = await makeDocument(owner);

    const res = await del(id);
    expect(res.status).toBe(401);
    expect(await prisma.document.findUnique({ where: { id } })).not.toBeNull();
  });
});
