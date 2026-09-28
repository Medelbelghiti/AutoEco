/**
 * Concurrency regression tests (real DB).
 *
 * The previous version of this file assumed the production schema. The
 * Lemon-Squeezy migration adds new columns. The helper below adds them
 * idempotently so the tests are self-contained and do not depend on a
 * separate "apply migrations" step.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tryConsume, release, type QuotaMetric } from "@/lib/quota";
import { getEntitlements } from "@/lib/plans";
import { handleStripeEvent } from "@/lib/stripe-webhook";
import { ensureLemonSqueezySchema } from "./_ensureSchema";

const DB_URL = process.env.DATABASE_URL ?? "";
const DB_OK = DB_URL.length > 0;

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  if (DB_OK) await ensureLemonSqueezySchema(prisma);
});

async function makeUserWithPlan(planOverrides: Record<string, unknown> = {}) {
  const plan = await prisma.plan.create({
    data: {
      key: `t_${stamp}_${Math.random().toString(36).slice(2, 5)}`,
      name: "Test", priceCents: 0, billingPeriod: "FREE",
      maxVehicles: 5, maxExpensesPerMonth: 1000,
      aiReceiptScansPerMonth: 100, aiConversationsPerMonth: 100,
      reportRetentionDays: 30, forecastHorizonMonths: 12,
      enableAdvancedScenarios: true, enableShareableReports: true,
      enableFamilySharing: false, enableApiAccess: false,
      features: "[]",
      ...planOverrides,
    },
  });
  const email = `${stamp}-${Math.random().toString(36).slice(2, 5)}@autoeco.app`;
  const user = await prisma.user.create({
    data: {
      email, passwordHash: "x", name: "T", role: "USER",
      planId: plan.id, currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM",
      stripeCustomerId: `cus_test_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  return { user, plan };
}

async function cleanup() {
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE '${stamp}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE '${stamp}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "QuotaUsage" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE '${stamp}%@autoeco.app')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Vehicle" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE '${stamp}%@autoeco.app')`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" LIKE '${stamp}%@autoeco.app'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Plan" WHERE "key" LIKE 't_${stamp}_%'`);
  } catch { /* noop */ }
}

describe.skipIf(!DB_OK)("AI quota concurrency (real DB)", () => {
  const prefix = `ai-${stamp}-`;
  const limit = 10;

  afterAll(async () => { await cleanup(); });

  it("100 concurrent AI requests against limit 10 → at most 10 succeed", async () => {
    const { user } = await makeUserWithPlan({ aiConversationsPerMonth: limit });
    const periodKey = `2026-09-${user.id}`;
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryConsume({ userId: user.id, metric: "ai_conversations" as QuotaMetric, periodKey, limit }))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBeLessThanOrEqual(limit);
    expect(allowed).toBe(limit); // exactly the limit (race allows all 10 in a deterministic single-statement)
    const row = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ai_conversations", periodKey } } });
    expect(row?.used).toBe(limit);
    expect(row?.used).toBeLessThanOrEqual(limit);
  });
});

describe.skipIf(!DB_OK)("OCR quota concurrency (real DB)", () => {
  const prefix = `ocr-${stamp}-`;
  const limit = 10;

  afterAll(async () => { await cleanup(); });

  it("100 concurrent OCR reservations against limit 10 → at most 10 succeed", async () => {
    const { user, plan } = await makeUserWithPlan({ aiReceiptScansPerMonth: 0 });
    await prisma.plan.update({ where: { id: plan.id }, data: { aiReceiptScansPerMonth: limit } });
    const periodKey = `2026-09-${user.id}`;
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryConsume({ userId: user.id, metric: "ocr_scans" as QuotaMetric, periodKey, limit }))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(limit);
    const row = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    expect(row?.used).toBe(limit);
  });
});

describe.skipIf(!DB_OK)("Vehicle limit concurrency (real DB)", () => {
  const prefix = `veh-${stamp}-`;

  afterAll(async () => { await cleanup(); });

  it("20 concurrent vehicle creates with maxVehicles=1 → exactly 1 success", async () => {
    const { user } = await makeUserWithPlan({ maxVehicles: 1 });
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryConsume({ userId: user.id, metric: "vehicles" as QuotaMetric, periodKey: `veh-${user.id}`, limit: 1 }))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(1);
    const row = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "vehicles", periodKey: `veh-${user.id}` } } });
    expect(row?.used).toBe(1);
  });
});

describe.skipIf(!DB_OK)("Expense limit concurrency (real DB)", () => {
  const prefix = `exp-${stamp}-`;

  afterAll(async () => { await cleanup(); });

  it("100 concurrent expense reservations against limit 10 → at most 10 succeed", async () => {
    const { user, plan } = await makeUserWithPlan({ maxExpensesPerMonth: 10 });
    const periodKey = `2026-09-${user.id}`;
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryConsume({ userId: user.id, metric: "expenses" as QuotaMetric, periodKey, limit: 10 }))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
    const row = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "expenses", periodKey } } });
    expect(row?.used).toBe(10);
  });
});

describe.skipIf(!DB_OK)("Stripe webhook concurrency (real DB)", () => {
  const prefix = `wh-${stamp}-`;

  afterAll(async () => { await cleanup(); });

  it("20 concurrent deliveries of the same event.id → exactly 1 PROCESSED", async () => {
    const { user } = await makeUserWithPlan();
    const eventId = `${stamp}-evt-${Math.random().toString(36).slice(2, 8)}`;

    const event = {
      id: eventId, object: "event", api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000), type: "unknown.event.type",
      livemode: false, pending_webhooks: 0, request: { id: null, idempotency_key: null },
      data: { object: {} as any },
    } as any;

    const N = 20;
    const results = await Promise.all(Array.from({ length: N }, () => handleStripeEvent(event)));
    const applied = results.filter((r) => r === "applied").length;
    const skipped = results.filter((r) => r === "skipped-other-worker").length;
    expect(applied).toBe(1);
    expect(applied + skipped).toBe(N);
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
    expect(row?.attempts).toBe(1);
  });
});
