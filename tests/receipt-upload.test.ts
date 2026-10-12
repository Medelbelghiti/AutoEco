/**
 * Upload receipt — the multipart POST contract, against a real database.
 *
 * The bug this pins: the receipts page posted `multipart/form-data` straight
 * to `/api/receipts` with a plain HTML form, so a success (or any error)
 * navigated the user to a raw JSON body. The page now submits the same
 * multipart form with `fetch` and renders the outcome itself; the server-side
 * validation, quota and storage behaviour is unchanged.
 *
 * Real DB, real route handler, mocked `next/headers` cookie jar. Local storage
 * driver so the file is written to a throwaway directory.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

// storage.ts captures STORAGE_DIR and the driver at import time; set them
// before the route (and therefore storage.ts) is imported below.
const STORAGE_DIR = join(tmpdir(), `autoeco-receipt-up-${Date.now()}`);
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = STORAGE_DIR;

const prisma = new PrismaClient();
const stamp = `recup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "receipt-up-secret-0123456789abcdef0123456789";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

// A minimal but genuine PDF: leading bytes must satisfy `bytesMatchMime`.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2]);

function uploadForm(vehicleId: string, title = "Test receipt") {
  const form = new FormData();
  form.set("vehicleId", vehicleId);
  form.set("title", title);
  form.set("category", "fuel");
  form.set("file", new File([PDF_BYTES], "receipt.pdf", { type: "application/pdf" }));
  return new Request("https://autoeco.test/api/receipts", { method: "POST", body: form });
}

runSuite("Upload receipt (real DB)", () => {
  let auth: typeof import("@/lib/auth");
  let route: typeof import("@/app/api/receipts/route");

  beforeAll(async () => {
    auth = await import("@/lib/auth");
    route = await import("@/app/api/receipts/route");
  });

  beforeEach(() => {
    jar.clear();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" LIKE '${stamp}-%@autoeco.test'`);
    await prisma.$disconnect();
    await rm(STORAGE_DIR, { recursive: true, force: true });
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

  async function makeVehicle(userId: string): Promise<string> {
    const v = await prisma.vehicle.create({ data: { userId, brand: "Test", model: "Car", year: 2020 } });
    return v.id;
  }

  it("an authenticated POST creates the document", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("owner");
    const vehicle = await prisma.vehicle.create({
      data: { userId: owner, brand: "Test", model: "Car", year: 2020 },
    });
    await auth.createSession(owner);

    const res = await route.POST(uploadForm(vehicle.id), undefined);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { document: { id: string; userId: string; vehicleId: string | null } };
    expect(body.document.userId).toBe(owner);
    expect(body.document.vehicleId).toBe(vehicle.id);

    const row = await prisma.document.findUnique({ where: { id: body.document.id } });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(owner);
  });

  it("a receipt cannot be created against another user's vehicle (404)", async () => {
    if (!DB_OK) return;
    const owner = await makeUser("owner2");
    const other = await makeUser("other");
    const vehicle = await prisma.vehicle.create({
      data: { userId: owner, brand: "Test", model: "Car", year: 2020 },
    });

    await auth.createSession(other);
    const res = await route.POST(uploadForm(vehicle.id), undefined);
    expect(res.status).toBe(404);
    expect(await prisma.document.count({ where: { userId: other } })).toBe(0);
  });

  it("an anonymous request (401) creates nothing", async () => {
    if (!DB_OK) return;
    const owner = await prisma.user.create({
      data: {
        email: `${stamp}-owner3@autoeco.test`,
        passwordHash: "x",
        name: "owner3",
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: { userId: owner.id, brand: "Test", model: "Car", year: 2020 },
    });

    const res = await route.POST(uploadForm(vehicle.id), undefined);
    expect(res.status).toBe(401);
    expect(await prisma.document.count({ where: { userId: owner.id } })).toBe(0);
  });
});
