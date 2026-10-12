/**
 * Paddle refunds (Task 1).
 *
 * Paddle Billing delivers refunds as `adjustment.created` /
 * `adjustment.updated` (`action: "refund"`, `status: "approved"`), NOT as
 * `transaction.refunded`. These tests drive the real webhook route (signature
 * included) against the real database and assert the agreed entitlement rule:
 *
 *   - a FULL refund of the LATEST paid transaction of a subscription cancels
 *     the subscription (Paddle cancel API is called);
 *   - a partial refund, or a refund of an older transaction when a later
 *     successful payment exists, only records the refunded amount;
 *   - replays and the created→updated pair apply exactly once;
 *   - non-refund / non-approved adjustments and unknown transactions are
 *     ignored without erroring;
 *   - a failed Paddle cancel never fails the webhook (flagged instead);
 *   - a stale refund does not cancel a subscription with a newer event.
 *
 * The Paddle REST API is never contacted: `globalThis.fetch` is stubbed.
 * Skipped (not failed) when DATABASE_URL is not local — see ./\_dbGuard.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensurePaddleSchema } from "./_ensureSchema";
import { DB_OK } from "./_dbGuard";
import { PLANS, planRow } from "../prisma/plans.data";

const prisma = new PrismaClient();

const SECRET = "pdl_test_webhook_secret_for_refunds";
const PRO_PRICE = "pri_paddle_pro_monthly_refund_test";
const API_KEY = "local-test-apikey-refund-fake";

// The route and `@/lib/env` snapshot process.env at import time.
process.env.PADDLE_WEBHOOK_SECRET = SECRET;
process.env.PADDLE_API_KEY = API_KEY;
process.env.PADDLE_SELLER_ID = "sel_refunds";
process.env.PADDLE_PRO_PRICE_ID = PRO_PRICE;

type WebhookRoute = { POST: (req: Request) => Promise<Response> };
let route: WebhookRoute | null = null;

let userId = "";
let freePlanId = "";

const originalFetch = globalThis.fetch;
let fetchMode: "ok" | "fail" = "ok";
const fetchCalls: { url: string; body: Record<string, unknown> | null }[] = [];

function sign(body: string, secret = SECRET): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

function payload(eventId: string, eventType: string, data: Record<string, unknown>, occurredAt = "2026-10-05T12:00:00.000Z"): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt,
    notification_id: `ntf_${eventId}`,
    data,
  });
}

async function post(body: string): Promise<Response> {
  return route!.POST(new Request("https://autoeco.test/api/paddle/webhook", {
    method: "POST",
    headers: { "paddle-signature": sign(body), "content-type": "application/json" },
    body,
  }));
}

/** A completed transaction payload for `transactionId` on `subId`. */
function completed(
  eventId: string,
  transactionId: string,
  subId: string,
  amount: string,
  createdAt: string
): string {
  return payload(
    eventId,
    "transaction.completed",
    {
      id: transactionId,
      status: "completed",
      customer_id: "ctm_p2",
      subscription_id: subId,
      custom_data: { userId },
      currency_code: "USD",
      created_at: createdAt,
      details: { totals: { grand_total: amount, currency_code: "USD" } },
    },
    createdAt
  );
}

/** A refund adjustment payload. */
function refund(
  eventId: string,
  adjustmentId: string,
  transactionId: string,
  subId: string | null,
  total: string,
  type: "full" | "partial",
  status = "approved",
  action = "refund",
  occurredAt = "2026-10-06T12:00:00.000Z"
): string {
  return payload(
    eventId,
    "adjustment.updated",
    {
      id: adjustmentId,
      action,
      type,
      status,
      transaction_id: transactionId,
      subscription_id: subId,
      customer_id: "ctm_p2",
      currency_code: "USD",
      totals: { total, currency_code: "USD", subtotal: total, tax: "0", fee: "0", earnings: total },
    },
    occurredAt
  );
}

async function invoiceFor(transactionId: string) {
  return prisma.invoice.findUnique({ where: { paddleOrderId: transactionId } });
}

async function auditActionsLike(needle: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { metadata: { contains: needle } },
    select: { action: true },
  });
  return rows.map((r) => r.action);
}

const run = DB_OK ? it : it.skip;

describe("Paddle refunds (adjustment.*)", () => {
  beforeAll(async () => {
    await ensurePaddleSchema(prisma);
    for (const p of PLANS) {
      const row = planRow(p);
      const { key, ...fields } = row;
      await prisma.plan.upsert({
        where: { key: key as string },
        create: { ...row, isDemo: false } as never,
        update: { ...fields, isDemo: false } as never,
      });
    }
    freePlanId = (await prisma.plan.findUniqueOrThrow({ where: { key: "free" } })).id;
    const user = await prisma.user.create({
      data: {
        email: "refunds@autoeco.test",
        passwordHash: "not-a-real-hash",
        name: "Refund Tester",
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
        planId: freePlanId,
      },
    });
    userId = user.id;
    route = (await import("@/app/api/paddle/webhook/route")) as unknown as WebhookRoute;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE 'p2_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'p2_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "RefundAdjustment" WHERE "transactionId" LIKE 'txn_p2_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" = '${userId}' OR "metadata" LIKE '%p2_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${userId}'`);
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  });

  beforeEach(() => {
    fetchMode = "ok";
    fetchCalls.length = 0;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      const ok = fetchMode === "ok";
      return { ok, status: fetchMode === "fail" ? 500 : 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
  });

  run("full refund of the latest transaction cancels the subscription", async () => {
    expect((await post(completed("p2_a_txn", "txn_p2_a", "sub_p2_a", "699", "2026-10-05T10:00:00.000Z"))).status).toBe(200);
    const before = await invoiceFor("txn_p2_a");
    expect(before!.paddleSubscriptionId).toBe("sub_p2_a");
    expect(before!.status).toBe("paid");

    const res = await post(refund("p2_a_refund", "adj_p2_a", "txn_p2_a", "sub_p2_a", "699", "full"));
    expect(res.status).toBe(200);

    const inv = await invoiceFor("txn_p2_a");
    expect(inv!.status).toBe("refunded");
    expect(inv!.refundedAmountCents).toBe(699);

    // The Paddle subscription is canceled immediately.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_p2_a/cancel");
    expect(fetchCalls[0].body).toMatchObject({ effective_from: "immediately" });
  });

  run("a partial refund records the amount and keeps access", async () => {
    await post(completed("p2_part_txn", "txn_p2_part", "sub_p2_part", "1000", "2026-10-05T10:00:00.000Z"));
    const res = await post(refund("p2_part_adj", "adj_p2_part", "txn_p2_part", "sub_p2_part", "300", "partial"));
    expect(res.status).toBe(200);

    const inv = await invoiceFor("txn_p2_part");
    expect(inv!.refundedAmountCents).toBe(300);
    expect(inv!.status).toBe("partially_refunded");
    // No cancel: access is kept.
    expect(fetchCalls).toHaveLength(0);
  });

  run("a full refund of an older transaction keeps access when a later payment exists", async () => {
    await post(completed("p2_old_txn", "txn_p2_old_1", "sub_p2_old", "699", "2026-10-05T10:00:00.000Z"));
    await post(completed("p2_new_txn", "txn_p2_old_2", "sub_p2_old", "699", "2026-11-05T10:00:00.000Z"));

    const res = await post(refund("p2_old_adj", "adj_p2_old", "txn_p2_old_1", "sub_p2_old", "699", "full"));
    expect(res.status).toBe(200);

    const refunded = await invoiceFor("txn_p2_old_1");
    expect(refunded!.status).toBe("refunded");
    // A later successful payment exists, so the subscription is NOT canceled.
    expect(fetchCalls).toHaveLength(0);
    expect(await auditActionsLike("p2_old_adj")).toContain("paddle.refund.older_transaction");
  });

  run("delivering the same event twice applies the refund once", async () => {
    await post(completed("p2_dup_txn", "txn_p2_dup", "sub_p2_dup", "699", "2026-10-05T10:00:00.000Z"));
    const body = refund("p2_dup_adj", "adj_p2_dup", "txn_p2_dup", "sub_p2_dup", "699", "full");

    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);

    expect(await prisma.refundAdjustment.count({ where: { adjustmentId: "adj_p2_dup" } })).toBe(1);
    const inv = await invoiceFor("txn_p2_dup");
    expect(inv!.refundedAmountCents).toBe(699);
    expect(fetchCalls).toHaveLength(1);
  });

  run("created(pending) + updated(approved) applies once; a second update is ignored", async () => {
    await post(completed("p2_pu_txn", "txn_p2_pu", "sub_p2_pu", "699", "2026-10-05T10:00:00.000Z"));
    const data = {
      id: "adj_p2_pu",
      action: "refund",
      type: "full",
      transaction_id: "txn_p2_pu",
      subscription_id: "sub_p2_pu",
      customer_id: "ctm_p2",
      currency_code: "USD",
      totals: { total: "699", currency_code: "USD" },
    };

    // Pending approval → ignored.
    expect((await post(payload("p2_pu_created", "adjustment.created", { ...data, status: "pending_approval" }))).status).toBe(200);
    expect(await prisma.refundAdjustment.count({ where: { adjustmentId: "adj_p2_pu" } })).toBe(0);
    expect(fetchCalls).toHaveLength(0);

    // Approved → applied.
    expect((await post(payload("p2_pu_upd1", "adjustment.updated", { ...data, status: "approved" }))).status).toBe(200);
    expect(await prisma.refundAdjustment.count({ where: { adjustmentId: "adj_p2_pu" } })).toBe(1);
    expect(fetchCalls).toHaveLength(1);

    // Another approved update of the SAME adjustment → no-op.
    expect((await post(payload("p2_pu_updated2", "adjustment.updated", { ...data, status: "approved" }))).status).toBe(200);
    expect(await prisma.refundAdjustment.count({ where: { adjustmentId: "adj_p2_pu" } })).toBe(1);
    expect(fetchCalls).toHaveLength(1);
  });

  run("non-refund and non-approved adjustments are ignored", async () => {
    await post(completed("p2_ign_txn", "txn_p2_ign", "sub_p2_ign", "699", "2026-10-05T10:00:00.000Z"));

    // A credit is not a refund.
    expect((await post(refund("p2_credit", "adj_p2_credit", "txn_p2_credit_unused", "sub_p2_credit", "699", "full", "approved", "credit"))).status).toBe(200);
    // A refund that is not approved.
    expect((await post(refund("p2_pending", "adj_p2_pending", "txn_p2_ign", "sub_p2_ign", "699", "full", "pending_approval"))).status).toBe(200);

    expect(await prisma.refundAdjustment.count({ where: { adjustmentId: { in: ["adj_p2_credit", "adj_p2_pending"] } } })).toBe(0);
    const inv = await invoiceFor("txn_p2_ign");
    expect(inv!.refundedAmountCents).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });

  run("an unknown transaction is ignored without erroring", async () => {
    const res = await post(refund("p2_unknown", "adj_p2_unknown", "txn_p2_does_not_exist", "sub_p2_unknown", "699", "full"));
    expect(res.status).toBe(200);
    expect(await prisma.refundAdjustment.count({ where: { adjustmentId: "adj_p2_unknown" } })).toBe(0);
    expect(await auditActionsLike("adj_p2_unknown")).toContain("paddle.refund.unknown_transaction");
  });

  run("a failed Paddle cancel does not fail the webhook and is flagged", async () => {
    await post(completed("p2_fail_txn", "txn_p2_fail", "sub_p2_fail", "699", "2026-10-05T10:00:00.000Z"));
    fetchMode = "fail";
    const res = await post(refund("p2_fail_adj", "adj_p2_fail", "txn_p2_fail", "sub_p2_fail", "699", "full"));
    expect(res.status).toBe(200);

    const inv = await invoiceFor("txn_p2_fail");
    expect(inv!.status).toBe("refunded");
    expect(await auditActionsLike("adj_p2_fail")).toContain("paddle.refund.cancel_failed");
  });

  run("a stale full refund does not cancel a subscription with a newer event", async () => {
    await post(completed("p2_stale_txn", "txn_p2_stale", "sub_p2_stale", "699", "2026-10-05T10:00:00.000Z"));
    // A newer subscription event has already been applied to this subscription.
    await prisma.subscription.create({
      data: {
        userId,
        planId: freePlanId,
        status: "active",
        paddleSubscriptionId: "sub_p2_stale",
        lastEventAt: new Date("2026-12-01T00:00:00.000Z"),
      },
    });

    const res = await post(
      refund("p2_stale_adj", "adj_p2_stale", "txn_p2_stale", "sub_p2_stale", "699", "full", "approved", "refund", "2026-10-06T12:00:00.000Z")
    );
    expect(res.status).toBe(200);
    expect(fetchCalls).toHaveLength(0);
    expect(await auditActionsLike("adj_p2_stale")).toContain("paddle.refund.stale_ignored");
  });
});
