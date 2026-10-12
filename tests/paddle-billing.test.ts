/**
 * Phase 1 — proof that the Paddle billing fixes actually hold, with
 * realistic Paddle Billing payloads against the real database.
 *
 * The webhook is driven through the real route handler (signature included),
 * not through a re-implementation of the side effects, so these tests fail if
 * the handler regresses.
 *
 * Amounts are STRINGS in minor units, exactly as Paddle Billing sends them:
 * `details.totals.grand_total: "699"` means 6.99 in a 2-decimal currency.
 *
 * Skipped (not failed) when DATABASE_URL is not local — see ./\_dbGuard.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensurePaddleSchema } from "./_ensureSchema";
import { DB_OK } from "./_dbGuard";
import { PLANS, planRow } from "../prisma/plans.data";

const prisma = new PrismaClient();

const SECRET = "pdl_test_webhook_secret_for_phase1";
const PRO_PRICE = "pri_paddle_pro_monthly_test";
const API_KEY = "pdl_sdbx_apikey_phase1_fake";

let userId = "";
let freePlanId = "";

// The route and `@/lib/env` snapshot process.env at import time, so the Paddle
// credentials must exist before the dynamic import below.
process.env.PADDLE_WEBHOOK_SECRET = SECRET;
process.env.PADDLE_API_KEY = API_KEY;
process.env.PADDLE_SELLER_ID = "sel_phase1";
process.env.PADDLE_PRO_PRICE_ID = PRO_PRICE;

type WebhookRoute = { POST: (req: Request) => Promise<Response> };
let route: WebhookRoute | null = null;

function sign(body: string, secret = SECRET): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

/** Build a realistic Paddle Billing payload (v2 "data" envelope). */
function payload(
  eventId: string,
  eventType: string,
  data: Record<string, unknown>,
  occurredAt: string
): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt,
    notification_id: `ntf_${eventId}`,
    data,
  });
}

async function post(body: string): Promise<Response> {
  if (!route) throw new Error("route not loaded");
  return route.POST(
    new Request("https://autoeco.test/api/paddle/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    })
  );
}

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Phase 1 — Paddle billing fixes (real DB)", () => {
  beforeAll(async () => {
    await ensurePaddleSchema(prisma);
    // The handler resolves a Plan by key; seed the canonical definitions.
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
        email: "phase1-billing@autoeco.test",
        passwordHash: "not-a-real-hash",
        name: "Phase One",
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
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE 'p1_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'p1_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" IS NULL AND "createdAt" > now() - interval '1 hour'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${userId}'`);
    await prisma.$disconnect();
  });

  run("1. transaction.completed stores minor units verbatim and keeps the currency", async () => {
    const body = payload(
      "p1_txn_completed",
      "transaction.completed",
      {
        id: "txn_p1_order_001",
        status: "completed",
        customer_id: "ctm_p1_phase1",
        subscription_id: "sub_p1_phase1",
        custom_data: { userId },
        currency_code: "BRL",
        details: {
          totals: {
            grand_total: "699",
            subtotal: "699",
            tax: "0",
            currency_code: "BRL",
          },
        },
      },
      "2026-10-05T10:00:00.000Z"
    );

    const res = await post(body);
    expect(res.status).toBe(200);

    const invoice = await prisma.invoice.findUnique({ where: { paddleOrderId: "txn_p1_order_001" } });
    expect(invoice).not.toBeNull();
    // 699 minor units, NOT 69900. The old code multiplied by 100.
    expect(invoice!.amountCents).toBe(699);
    // Real ISO 4217 code, not coerced to USD.
    expect(invoice!.currency).toBe("BRL");
    expect(invoice!.status).toBe("paid");
  });

  run("1b. a 3-decimal-looking total is still not rescaled", async () => {
    const body = payload(
      "p1_txn_large",
      "transaction.completed",
      {
        id: "txn_p1_order_large",
        status: "completed",
        custom_data: { userId },
        currency_code: "INR",
        details: { totals: { grand_total: "199900", currency_code: "INR" } },
      },
      "2026-10-05T10:05:00.000Z"
    );
    await post(body);
    const invoice = await prisma.invoice.findUnique({ where: { paddleOrderId: "txn_p1_order_large" } });
    expect(invoice!.amountCents).toBe(199900);
    expect(invoice!.currency).toBe("INR");
  });

  run("2. an out-of-order subscription.updated cannot resurrect a canceled subscription", async () => {
    const subId = "sub_p1_outoforder";
    await prisma.subscription.create({
      data: {
        userId,
        planId: freePlanId,
        status: "active",
        paddleSubscriptionId: subId,
        currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
      },
    });

    // t2 — the cancellation (delivered first, in time).
    const canceled = payload(
      "p1_canceled",
      "subscription.canceled",
      {
        id: subId,
        status: "canceled",
        customer_id: "ctm_p1_phase1",
        subscription_id: subId,
        custom_data: { userId },
      },
      "2026-10-05T12:00:00.000Z"
    );
    expect((await post(canceled)).status).toBe(200);
    const afterCancel = await prisma.subscription.findUniqueOrThrow({ where: { paddleSubscriptionId: subId } });
    expect(afterCancel.status).toBe("canceled");
    const t2 = afterCancel.lastEventAt!.getTime();
    expect(t2).toBe(new Date("2026-10-05T12:00:00.000Z").getTime());

    // t1 < t2 — the older "updated" arriving late must be ignored.
    const stale = payload(
      "p1_stale_update",
      "subscription.updated",
      {
        id: subId,
        status: "active",
        customer_id: "ctm_p1_phase1",
        subscription_id: subId,
        custom_data: { userId },
        items: [{ price: { id: PRO_PRICE } }],
        current_billing_period: {
          starts_at: "2026-10-01T00:00:00Z",
          ends_at: "2026-11-01T00:00:00Z",
        },
      },
      "2026-10-05T11:00:00.000Z"
    );
    expect((await post(stale)).status).toBe(200);

    const afterStale = await prisma.subscription.findUniqueOrThrow({ where: { paddleSubscriptionId: subId } });
    expect(afterStale.status).toBe("canceled");
    // lastEventAt must not move backwards.
    expect(afterStale.lastEventAt!.getTime()).toBe(t2);

    // The guard must be auditable, otherwise a silent misconfiguration is
    // indistinguishable from Paddle never sending the event.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "paddle.webhook.stale_event_ignored" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toContain("p1_stale_update");
    expect(audit!.metadata).toContain(subId);
  });

  run("3. past_due after canceled does not flip the subscription back", async () => {
    const subId = "sub_p1_outoforder";
    const before = await prisma.subscription.findUniqueOrThrow({ where: { paddleSubscriptionId: subId } });
    expect(before.status).toBe("canceled");

    // Later in time, so the stale guard lets it through...
    const pastDue = payload(
      "p1_past_due",
      "subscription.past_due",
      {
        id: subId,
        status: "past_due",
        customer_id: "ctm_p1_phase1",
        subscription_id: subId,
        custom_data: { userId },
      },
      "2026-10-05T13:00:00.000Z"
    );
    expect((await post(pastDue)).status).toBe(200);

    // ...but a canceled subscription must stay canceled.
    const after = await prisma.subscription.findUniqueOrThrow({ where: { paddleSubscriptionId: subId } });
    expect(after.status).toBe("canceled");
    expect(after.canceledAt).not.toBeNull();

    // The guard filters on the row itself (`status notIn [lifetime, canceled]`),
    // so a past_due event does not touch a canceled subscription at all — not
    // even `lastEventAt`. That is the conservative direction: the event is
    // dropped rather than partially applied.
    expect(after.lastEventAt!.getTime()).toBe(new Date("2026-10-05T12:00:00.000Z").getTime());

    // A genuinely newer event is still processed, so the row is not wedged.
    const resumed = payload(
      "p1_past_due_later",
      "subscription.payment_failed",
      {
        id: subId,
        status: "past_due",
        customer_id: "ctm_p1_phase1",
        subscription_id: subId,
        custom_data: { userId },
      },
      "2026-10-05T14:00:00.000Z"
    );
    expect((await post(resumed)).status).toBe(200);
    const stillCanceled = await prisma.subscription.findUniqueOrThrow({ where: { paddleSubscriptionId: subId } });
    expect(stillCanceled.status).toBe("canceled");
  });
});

/* ------------------------------------------------------------------ */
/* 8. Paddle REST client — pure, fetch mocked, never the real API      */
/* ------------------------------------------------------------------ */

describe("Phase 1 — paddle-api client (mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  let nextResponse: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: {} };

  beforeAll(() => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return {
        ok: nextResponse.ok,
        status: nextResponse.status,
        json: async () => nextResponse.body,
      } as Response;
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  const loadApi = async (env?: string) => {
    if (env === undefined) delete process.env.PADDLE_ENV;
    else process.env.PADDLE_ENV = env;
    vi.resetModules();
    return import("@/lib/paddle-api");
  };

  it("8a. targets the sandbox host by default and the live host when PADDLE_ENV=live", async () => {
    let api = await loadApi(undefined);
    captured = null;
    await api.cancelPaddleSubscription("sub_123", true);
    expect(captured!.url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_123/cancel");

    api = await loadApi("live");
    captured = null;
    await api.cancelPaddleSubscription("sub_123", true);
    expect(captured!.url).toBe("https://api.paddle.com/subscriptions/sub_123/cancel");
    await loadApi("sandbox");
  });

  it("8b. sends the API key as a bearer token and encodes the id", async () => {
    const api = await loadApi("sandbox");
    captured = null;
    await api.cancelPaddleSubscription("sub/with space&x", false);
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(captured!.url).toContain("sub%2Fwith%20space%26x");
  });

  it("8c. effective_from matches the caller's intent", async () => {
    const api = await loadApi("sandbox");

    captured = null;
    await api.cancelPaddleSubscription("sub_1", true);
    expect(JSON.parse(captured!.init.body as string).effective_from).toBe("next_billing_period");

    captured = null;
    await api.cancelPaddleSubscription("sub_1", false);
    expect(JSON.parse(captured!.init.body as string).effective_from).toBe("immediately");

    captured = null;
    await api.removePaddleScheduledCancellation("sub_1");
    expect(captured!.init.method).toBe("PATCH");
    expect(JSON.parse(captured!.init.body as string).scheduled_change).toBeNull();
  });

  it("8d. a provider error never leaks the provider's body", async () => {
    const api = await loadApi("sandbox");
    nextResponse = {
      ok: false,
      status: 422,
      body: { error: { type: "validation", detail: "internal vendor code X-9911" } },
    };
    await expect(api.cancelPaddleSubscription("sub_1", true)).rejects.toMatchObject({
      name: "PaddleApiError",
      status: 422,
      message: "The billing provider rejected the request",
    });
    // The message must not contain the provider payload.
    await expect(
      api.cancelPaddleSubscription("sub_1", true).catch((e: Error) => e.message)
    ).resolves.not.toContain("X-9911");
    nextResponse = { ok: true, status: 200, body: {} };
  });

  it("8e. a portal session without a URL is a 502, not a silent success", async () => {
    const api = await loadApi("sandbox");
    nextResponse = { ok: true, status: 200, body: { data: { urls: {} } } };
    await expect(api.createPaddlePortalUrl("ctm_1")).rejects.toMatchObject({ status: 502 });

    nextResponse = {
      ok: true,
      status: 200,
      body: { data: { urls: { general: { overview: "https://portal.paddle.com/x" } } } },
    };
    await expect(api.createPaddlePortalUrl("ctm_1")).resolves.toBe("https://portal.paddle.com/x");
    nextResponse = { ok: true, status: 200, body: {} };
  });
});