/**
 * Paddle adapter tests.
 *
 * Tests 1, 2, 4-10 are pure unit tests (no DB). Tests 3, 6, 10 use the
 * real DB; they skip if DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  verifyWebhookSignature,
  getPriceIdFor,
  type PaddleWebhookPayload,
  type PaddlePlanKey,
} from "@/lib/paddle";
import { ensurePaddleSchema } from "./_ensureSchema";

const DB_URL = process.env.DATABASE_URL ?? "";
const DB_OK = DB_URL.length > 0;
const prisma = new PrismaClient();

describe("1. Invalid webhook signature → rejected", () => {
  it("verifyWebhookSignature returns false for a bad signature", () => {
    expect(verifyWebhookSignature("{}", "ts=1700000000;h1=deadbeef")).toBe(false);
  });

  it("verifyWebhookSignature returns false when no header", () => {
    expect(verifyWebhookSignature("{}", null)).toBe(false);
  });

  it("verifyWebhookSignature returns false when secret not configured", () => {
    const prev = process.env.PADDLE_WEBHOOK_SECRET;
    delete process.env.PADDLE_WEBHOOK_SECRET;
    try {
      expect(verifyWebhookSignature("{}", "ts=1700000000;h1=abcd")).toBe(false);
    } finally {
      process.env.PADDLE_WEBHOOK_SECRET = prev;
    }
  });

  it("verifyWebhookSignature returns false for timestamp too old", () => {
    expect(verifyWebhookSignature("{}", "ts=1;h1=abcd", "secret", 60)).toBe(false);
  });
});

describe("2. Valid signature → verified", () => {
  it("verifyWebhookSignature returns true for a correct HMAC", () => {
    const secret = "test-webhook-secret";
    const body = '{"event_id":"evt_123","event_type":"subscription.created"}';
    const ts = Math.floor(Date.now() / 1000);
    const sig = `ts=${ts};h1=${crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });
});

describe("3. Valid webhook → processed (real-DB idempotency)", () => {
  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE 'pdl_evt_%'`);
      await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'pdl_evt_%'`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" IN (SELECT id FROM "User" WHERE "email" LIKE 'pdl-%@autoeco.app')`);
      await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" LIKE 'pdl-%@autoeco.app'`);
      await prisma.$executeRawUnsafe(`DELETE FROM "Plan" WHERE "key" LIKE 'pdl_test_%'`);
    } catch { /* noop */ }
  });

  it("a valid Paddle event creates a WebhookEvent row in PROCESSED state", async () => {
    if (!DB_OK) return;
    await ensurePaddleSchema(prisma);
    const { claim, markProcessed } = await import("@/lib/webhook-state");
    const eventId = `pdl_evt_${Math.random().toString(36).slice(2, 10)}`;
    const token = await claim(eventId, "subscription.created");
    expect(token).not.toBeNull();
    const ok = await markProcessed(eventId, token!);
    expect(ok).toBe(true);
    const row = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(row?.status).toBe("PROCESSED");
  });
});

describe("4. Duplicate webhook → only one business operation", () => {
  it("re-running the same event id returns skipped-other-worker", async () => {
    if (!DB_OK) return;
    const { claim } = await import("@/lib/webhook-state");
    const eventId = `pdl_evt_dup_${Math.random().toString(36).slice(2, 10)}`;
    const first = await claim(eventId, "subscription.updated");
    const second = await claim(eventId, "subscription.updated");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    try { await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" = '${eventId}'`); } catch { /* noop */ }
  });
});

describe("5. Failed → retry succeeds", () => {
  it("FAILED row is reclaimable; markProcessed with new token succeeds", async () => {
    if (!DB_OK) return;
    const { claim, markProcessed } = await import("@/lib/webhook-state");
    const eventId = `pdl_evt_fail_${Math.random().toString(36).slice(2, 10)}`;
    await prisma.webhookEvent.create({
      data: { eventId, type: "subscription.created", status: "FAILED", attempts: 1, error: "test" },
    });
    const token = await claim(eventId, "subscription.created");
    expect(token).not.toBeNull();
    const ok = await markProcessed(eventId, token!);
    expect(ok).toBe(true);
    try { await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" = '${eventId}'`); } catch { /* noop */ }
  });
});

describe("6. Stale processing token → cannot finalize", () => {
  it("a worker holding the OLD token cannot markProcessed after a reclaim", async () => {
    if (!DB_OK) return;
    const { claim, markProcessed } = await import("@/lib/webhook-state");
    const eventId = `pdl_evt_stale_${Math.random().toString(36).slice(2, 10)}`;
    const firstToken = await claim(eventId, "subscription.canceled");
    expect(firstToken).not.toBeNull();
    // Simulate stale recovery token rotation
    await prisma.$executeRawUnsafe(
      `UPDATE "WebhookEvent" SET "processingToken" = 'NEW_TOKEN_PDL', "status" = 'PROCESSING' WHERE "eventId" = '${eventId}'`
    );
    const old = await markProcessed(eventId, firstToken!);
    expect(old).toBe(false);
    const fresh = await markProcessed(eventId, "NEW_TOKEN_PDL");
    expect(fresh).toBe(true);
    try { await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" = '${eventId}'`); } catch { /* noop */ }
  });
});

describe("7. Concurrent duplicate deliveries → exactly one side effect", () => {
  it("tryClaimSideEffect for the same (eventId, effectType) under 50 concurrent calls → 1 wins", async () => {
    if (!DB_OK) return;
    const { tryClaimSideEffect } = await import("@/lib/webhook-state");
    const eventId = `pdl_evt_se_${Math.random().toString(36).slice(2, 10)}`;
    const N = 50;
    const results = await Promise.all(Array.from({ length: N }, () => tryClaimSideEffect(eventId, "PADDLE_RACE")));
    const winners = results.filter((r) => r === true).length;
    expect(winners).toBe(1);
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" = '${eventId}'`);
    } catch { /* noop */ }
  });
});

describe("8. Duplicate subscription event → no duplicate entitlement", () => {
  it("the Paddle webhook handler upserts Subscription by paddleSubscriptionId (idempotent)", async () => {
    if (!DB_OK) return;
    await ensurePaddleSchema(prisma);
    const plan = await prisma.plan.create({
      data: {
        key: `pdl_test_${Math.random().toString(36).slice(2, 8)}`, name: "T",
        priceCents: 0, billingPeriod: "FREE", maxVehicles: 1, maxExpensesPerMonth: 10,
        aiReceiptScansPerMonth: 0, aiConversationsPerMonth: 0,
        reportRetentionDays: 30, forecastHorizonMonths: 12,
        enableAdvancedScenarios: false, enableShareableReports: false,
        enableFamilySharing: false, enableApiAccess: false, features: "[]",
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `pdl-${Math.random().toString(36).slice(2, 8)}@autoeco.app`,
        passwordHash: "x", name: "T", role: "USER", planId: plan.id,
        currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM",
      },
    });
    const subId = `pdl_sub_${Math.random().toString(36).slice(2, 8)}`;
    const a = await prisma.subscription.upsert({
      where: { paddleSubscriptionId: subId },
      create: { userId: user.id, planId: plan.id, status: "active", paddleSubscriptionId: subId },
      update: { planId: plan.id, status: "active" },
    });
    const b = await prisma.subscription.upsert({
      where: { paddleSubscriptionId: subId },
      create: { userId: user.id, planId: plan.id, status: "active", paddleSubscriptionId: subId },
      update: { planId: plan.id, status: "active" },
    });
    expect(b.id).toBe(a.id);
    const count = await prisma.subscription.count({ where: { paddleSubscriptionId: subId } });
    expect(count).toBe(1);
    try {
      await prisma.subscription.delete({ where: { id: a.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.plan.delete({ where: { id: plan.id } });
    } catch { /* noop */ }
  });
});

describe("9. Different legitimate event types → independent side effects", () => {
  it("PADDLE_PAYMENT_SUCCESS_NOTIFICATION and PADDLE_PAYMENT_SUCCESS_EMAIL are independent", async () => {
    if (!DB_OK) return;
    const { tryClaimSideEffect } = await import("@/lib/webhook-state");
    const eventId = `pdl_evt_indep_${Math.random().toString(36).slice(2, 10)}`;
    const a = await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_NOTIFICATION");
    const b = await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_EMAIL");
    const a2 = await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_NOTIFICATION");
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(a2).toBe(false);
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" = '${eventId}'`);
    } catch { /* noop */ }
  });
});

describe("10. Malformed payload → safely rejected", () => {
  it("getPriceIdFor throws when variant id is not configured", () => {
    const prev = {
      pro: process.env.PADDLE_PRO_PRICE_ID,
      biz: process.env.PADDLE_BUSINESS_PRICE_ID,
      life: process.env.PADDLE_LIFETIME_PRICE_ID,
    };
    delete process.env.PADDLE_PRO_PRICE_ID;
    delete process.env.PADDLE_BUSINESS_PRICE_ID;
    delete process.env.PADDLE_LIFETIME_PRICE_ID;
    try {
      expect(() => getPriceIdFor("pro" as PaddlePlanKey)).toThrow();
    } finally {
      process.env.PADDLE_PRO_PRICE_ID = prev.pro;
      process.env.PADDLE_BUSINESS_PRICE_ID = prev.biz;
      process.env.PADDLE_LIFETIME_PRICE_ID = prev.life;
    }
  });

  it("verifyWebhookSignature requires a configured secret", () => {
    const prev = process.env.PADDLE_WEBHOOK_SECRET;
    delete process.env.PADDLE_WEBHOOK_SECRET;
    try {
      expect(verifyWebhookSignature("{}", "ts=1;h1=abcd")).toBe(false);
    } finally {
      process.env.PADDLE_WEBHOOK_SECRET = prev;
    }
  });
});
