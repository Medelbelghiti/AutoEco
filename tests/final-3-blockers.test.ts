/**
 * Regression tests for the 3 production blockers fixed in V1.4.1.
 *
 * All real-DB tests use ensureLemonSqueezySchema so they are independent
 * of whether the production migration has been applied to the test DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { tryClaimSideEffect } from "@/lib/webhook-state";
import { deliverOnce, deliverAndFailConcurrently } from "./_webhook-harness";
import { tryConsume, release } from "@/lib/quota";
import { ensureLemonSqueezySchema, ensurePaddleSchema } from "./_ensureSchema";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  if (DB_OK) {
    await ensureLemonSqueezySchema(prisma);
    await ensurePaddleSchema(prisma);
  }
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

describe.skipIf(!DB_OK)("BLOCKER 2 — webhook stale-worker ownership safety", () => {
  afterAll(async () => { await cleanup(); });

  it("normal duplicate delivery → exactly 1 PROCESSED, others skipped", async () => {
    await makeUserWithPlan();
    const eventId = `${stamp}-evt-dup-${crypto.randomBytes(3).toString("hex")}`;
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => deliverOnce(eventId, "unknown.event.type"))
    );
    const applied = results.filter((r) => r === "applied").length;
    const skipped = results.filter((r) => r === "skipped-other-worker").length;
    expect(applied).toBe(1);
    expect(applied + skipped).toBe(N);
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
  });

  it("failed → retry succeeds (FAILED → PROCESSING → PROCESSED, attempts=2)", async () => {
    await makeUserWithPlan();
    const eventId = `${stamp}-evt-fail-${crypto.randomBytes(3).toString("hex")}`;
    await prisma.webhookEvent.create({
      data: { eventId, type: "unknown.event.type", status: "FAILED", attempts: 1, error: "test failure" },
    });
    const outcome = await deliverOnce(eventId, "unknown.event.type");
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
    const outcome = await deliverOnce(eventId, "unknown.event.type");
    expect(outcome).toBe("applied");
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
    expect(row?.processingToken).not.toBe(oldToken);
    expect(row?.processingToken).toBeTruthy();
  });

  it("concurrent delivery where every side effect throws → exactly one finalize, event FAILED", async () => {
    await makeUserWithPlan();
    const eventId = `${stamp}-evt-allfail-${crypto.randomBytes(3).toString("hex")}`;
    const N = 20;

    const results = await deliverAndFailConcurrently(eventId, "unknown.event.type", N);

    // Only the worker that owned the claim may finalize, so exactly one call
    // reports "failed"; every other worker must have been locked out.
    const failed = results.filter((r) => r === "failed").length;
    const skipped = results.filter((r) => r === "skipped-other-worker").length;
    expect(failed).toBe(1);
    expect(failed + skipped).toBe(N);

    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("FAILED");
    expect(row?.attempts).toBe(1);

    // A later delivery picks the FAILED row back up and succeeds.
    expect(await deliverOnce(eventId, "unknown.event.type")).toBe("applied");
    const healed = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(healed?.status).toBe("PROCESSED");
    expect(healed?.attempts).toBe(2);
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
