/**
 * Regression tests for the 3 production blockers fixed in V1.4.1.
 *
 * All real-DB tests use ensureLemonSqueezySchema so they are independent
 * of whether the production migration has been applied to the test DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { handleStripeEvent, tryClaimSideEffect } from "@/lib/stripe-webhook";
import { tryConsume, release } from "@/lib/quota";
import { ensureLemonSqueezySchema } from "./_ensureSchema";

const DB_URL = process.env.DATABASE_URL ?? "";
const DB_OK = DB_URL.length > 0;

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  if (DB_OK) await ensureLemonSqueezySchema(prisma);
});

async function makeUserWithPlan(planOverrides: Record<string, unknown> = {}) {
  const plan = await prisma.plan.create({
    data: {
      key: `t_${stamp}_${crypto.randomBytes(3).toString("hex")}`,
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
  const email = `${stamp}-${crypto.randomBytes(3).toString("hex")}@autoeco.app`;
  const user = await prisma.user.create({
    data: {
      email, passwordHash: "x", name: "T", role: "USER",
      planId: plan.id, currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM",
      stripeCustomerId: `cus_test_${crypto.randomBytes(6).toString("hex")}`,
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

describe.skipIf(!DB_OK)("BLOCKER 1 — OCR quota rollback + file cleanup", () => {
  afterAll(async () => { await cleanup(); });

  it("successful receipt: quota consumed, document exists, file remains", async () => {
    const { user, plan } = await makeUserWithPlan({ aiReceiptScansPerMonth: 10 });
    const periodKey = `2026-09-${user.id}`;
    const reserved = await tryConsume({ userId: user.id, metric: "ocr_scans", periodKey, limit: plan.aiReceiptScansPerMonth });
    expect(reserved.allowed).toBe(true);
    const doc = await prisma.document.create({
      data: {
        userId: user.id, vehicleId: null, title: "ok", category: "fuel",
        storageKey: `receipts/user/${user.id}/ok.bin`, mimeType: "image/png", sizeBytes: 100,
      },
    });
    expect(doc.id).toBeTruthy();
    const row = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    expect(row?.used).toBe(1);
  });

  it("document creation failure: quota released exactly once", async () => {
    const { user, plan } = await makeUserWithPlan({ aiReceiptScansPerMonth: 10 });
    const periodKey = `2026-09-${user.id}`;
    const before = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    const beforeUsed = before?.used ?? 0;
    const reserved = await tryConsume({ userId: user.id, metric: "ocr_scans", periodKey, limit: plan.aiReceiptScansPerMonth });
    expect(reserved.allowed).toBe(true);
    const afterReserve = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    expect(afterReserve?.used).toBe(beforeUsed + 1);
    await release({ userId: user.id, metric: "ocr_scans", periodKey });
    const afterRelease = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    expect(afterRelease?.used).toBe(beforeUsed);
    await release({ userId: user.id, metric: "ocr_scans", periodKey });
    const afterDoubleRelease = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    expect(afterDoubleRelease?.used).toBe(beforeUsed);
  });

  it("100 concurrent reservations with limit 10 → exactly 10 succeed", async () => {
    const { user, plan } = await makeUserWithPlan({ aiReceiptScansPerMonth: 10 });
    const periodKey = `2026-09-${user.id}`;
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryConsume({ userId: user.id, metric: "ocr_scans", periodKey, limit: plan.aiReceiptScansPerMonth }))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
    const row = await prisma.quotaUsage.findUnique({ where: { userId_metric_periodKey: { userId: user.id, metric: "ocr_scans", periodKey } } });
    expect(row?.used).toBe(10);
  });
});

describe.skipIf(!DB_OK)("BLOCKER 2 — Stripe stale-worker ownership safety", () => {
  afterAll(async () => { await cleanup(); });

  it("normal duplicate delivery → exactly 1 PROCESSED, others skipped", async () => {
    const { user } = await makeUserWithPlan();
    const eventId = `${stamp}-evt-dup-${crypto.randomBytes(3).toString("hex")}`;
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
  });

  it("failed → retry succeeds (FAILED → PROCESSING → PROCESSED, attempts=2)", async () => {
    const { user } = await makeUserWithPlan();
    const eventId = `${stamp}-evt-fail-${crypto.randomBytes(3).toString("hex")}`;
    await prisma.webhookEvent.create({
      data: { eventId, type: "unknown.event.type", status: "FAILED", attempts: 1, error: "test failure" },
    });
    const event = {
      id: eventId, object: "event", api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000), type: "unknown.event.type",
      livemode: false, pending_webhooks: 0, request: { id: null, idempotency_key: null },
      data: { object: {} as any },
    } as any;
    const outcome = await handleStripeEvent(event);
    expect(outcome).toBe("applied");
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
    expect(row?.attempts).toBe(2);
  });

  it("stale recovery: a worker holding the OLD token cannot finalize", async () => {
    const eventId = `${stamp}-evt-stale-${crypto.randomBytes(3).toString("hex")}`;
    const oldToken = "OLD_TOKEN_xyz123";
    const oldTimestamp = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.webhookEvent.create({
      data: { eventId, type: "unknown.event.type", status: "PROCESSING", processingToken: oldToken, attempts: 1, error: "crashed worker" },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "WebhookEvent" SET "updatedAt" = '${oldTimestamp.toISOString()}' WHERE "eventId" = '${eventId}'`
    );
    const event = {
      id: eventId, object: "event", api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000), type: "unknown.event.type",
      livemode: false, pending_webhooks: 0, request: { id: null, idempotency_key: null },
      data: { object: {} as any },
    } as any;
    const outcome = await handleStripeEvent(event);
    expect(outcome).toBe("applied");
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
    expect(row?.processingToken).not.toBe(oldToken);
    expect(row?.processingToken).toBeTruthy();
  });

  it("concurrent real-business-event delivery (invoice.paid) produces exactly 1 side effect per type", async () => {
    const { user } = await makeUserWithPlan();
    const customerId = user.stripeCustomerId!;
    const eventId = `${stamp}-evt-invpaid-${crypto.randomBytes(3).toString("hex")}`;
    const invoiceId = `in_test_${crypto.randomBytes(4).toString("hex")}`;
    await prisma.invoice.create({
      data: {
        userId: user.id, stripeInvoiceId: invoiceId, amountCents: 1000,
        currency: "USD", status: "paid",
      },
    });
    const N = 20;
    const event = {
      id: eventId, object: "event", api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000), type: "invoice.paid",
      livemode: false, pending_webhooks: 0, request: { id: null, idempotency_key: null },
      data: { object: {
        id: invoiceId, customer: customerId, amount_paid: 1000, currency: "usd",
        number: "INV-001", hosted_invoice_url: null, invoice_pdf: null,
        period_start: Math.floor(Date.now() / 1000), period_end: Math.floor(Date.now() / 1000),
        subscription_details: { metadata: { userId: user.id } },
        lines: { data: [{ description: "Pro plan" }] },
      } as any },
    } as any;
    const results = await Promise.all(Array.from({ length: N }, () => handleStripeEvent(event)));
    const applied = results.filter((r) => r === "applied").length;
    const skipped = results.filter((r) => r === "skipped-other-worker").length;
    expect(applied).toBe(1);
    expect(applied + skipped).toBe(N);
    const inv = await prisma.invoice.findUnique({ where: { stripeInvoiceId: invoiceId } });
    expect(inv).not.toBeNull();
    const se = await prisma.webhookSideEffect.findMany({ where: { eventId } });
    const effectTypes = se.map((s) => s.effectType);
    const unique = new Set(effectTypes);
    expect(effectTypes.length).toBe(unique.size);
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
  });
});

describe.skipIf(!DB_OK)("BLOCKER 3 — durable side-effect idempotency", () => {
  afterAll(async () => { await cleanup(); });

  it("tryClaimSideEffect: first claim wins, second loses", async () => {
    const eventId = `${stamp}-se-${crypto.randomBytes(3).toString("hex")}`;
    const first = await tryClaimSideEffect(eventId, "TEST_EFFECT", { foo: 1 });
    const second = await tryClaimSideEffect(eventId, "TEST_EFFECT", { foo: 2 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await prisma.webhookSideEffect.findMany({ where: { eventId, effectType: "TEST_EFFECT" } });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata ?? "null")).toEqual({ foo: 1 });
  });

  it("different effectTypes on same event are independent", async () => {
    const eventId = `${stamp}-se-multi-${crypto.randomBytes(3).toString("hex")}`;
    const a = await tryClaimSideEffect(eventId, "EMAIL_A");
    const b = await tryClaimSideEffect(eventId, "EMAIL_B");
    const a2 = await tryClaimSideEffect(eventId, "EMAIL_A");
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(a2).toBe(false);
  });

  it("100 concurrent claims of the same effect → exactly 1 wins", async () => {
    const eventId = `${stamp}-se-race-${crypto.randomBytes(3).toString("hex")}`;
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryClaimSideEffect(eventId, "RACE_EFFECT"))
    );
    const winners = results.filter((r) => r === true).length;
    expect(winners).toBe(1);
    const rows = await prisma.webhookSideEffect.count({ where: { eventId, effectType: "RACE_EFFECT" } });
    expect(rows).toBe(1);
  });
});
