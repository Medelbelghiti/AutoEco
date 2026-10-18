/**
 * PayPal "Founder Lifetime" â€” one-time purchase.
 *
 * Real DB, real route handlers, real cap/grant transactions. EVERY PayPal HTTP
 * call is mocked (`global.fetch`): the sandbox is never contacted, and no
 * credential leaves the process.
 *
 * `next/headers` is mocked with an in-memory cookie jar so the real
 * `createSession` / `getCurrentUser` pair can be exercised outside a request
 * scope â€” the same pattern as `auth-hardening.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";
import { ensurePaddleSchema, ensurePaymentOrderSchema } from "./_ensureSchema";
import { PLANS, LIFETIME_PLAN, planRow } from "../prisma/plans.data";

const prisma = new PrismaClient();
const stamp = `ppl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Route {
  POST: (req: Request) => Promise<Response>;
}

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const sentEmails: string[] = [];
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (opts: { to: string }) => {
      sentEmails.push(opts.to);
      return { ok: true } as never;
    }),
  };
});

// ---- Environment: billing ON, sandbox, dummy credentials ----
process.env.AUTH_SECRET = "paypal-lifetime-secret-0123456789abcdef0123456789";
process.env.BILLING_ENABLED = "true";
process.env.PAYPAL_ENV = "sandbox";
process.env.PAYPAL_CLIENT_ID = "test-client-id";
process.env.PAYPAL_CLIENT_SECRET = "test-client-secret";
process.env.PAYPAL_WEBHOOK_ID = "test-webhook-id";
process.env.LIFETIME_PRICE_MINOR = "9900";
process.env.LIFETIME_CURRENCY = "USD";
process.env.LIFETIME_MAX_GRANTS = "100";

// ---- Mocked PayPal HTTP ----
interface MockOrderConfig {
  captureStatus?: number;
  captureOrderStatus?: string;
  captureId?: string;
  verifyStatus?: string;
}
let paypalConfig: MockOrderConfig = {};
let lastCreatePayload: Record<string, unknown> | null = null;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function captureBody(orderStatus: string, captureId: string): Record<string, unknown> {
  return {
    id: "ORDER",
    status: orderStatus,
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: captureId,
              status: "COMPLETED",
              amount: { currency_code: "USD", value: "99.00" },
            },
          ],
        },
      },
    ],
  };
}

function installFetchMock(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/oauth2/token")) {
        return jsonResponse({ access_token: "test-access-token" }, 200);
      }
      if (url.includes("/v1/notifications/verify-webhook-signature")) {
        return jsonResponse({ verification_status: paypalConfig.verifyStatus ?? "SUCCESS" }, 200);
      }
      if (url.endsWith("/v2/checkout/orders") && (init?.method ?? "").toUpperCase() === "POST") {
        lastCreatePayload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({ id: `ORDER-${Math.random().toString(36).slice(2)}`, status: "CREATED" }, 201);
      }
      if (url.includes("/capture")) {
        if ((paypalConfig.captureStatus ?? 201) >= 400) {
          return jsonResponse({ name: "ORDER_ALREADY_CAPTURED" }, paypalConfig.captureStatus ?? 422);
        }
        return jsonResponse(
          captureBody(paypalConfig.captureOrderStatus ?? "COMPLETED", paypalConfig.captureId ?? "CAPTURE-1"),
          201
        );
      }
      return jsonResponse(
        captureBody(paypalConfig.captureOrderStatus ?? "COMPLETED", paypalConfig.captureId ?? "CAPTURE-1"),
        200
      );
    })
  );
}

type AuthLib = typeof import("@/lib/auth");
let auth: AuthLib;

function webhookRequest(body: unknown): Request {
  return new Request("http://localhost/api/paypal/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paypal-transmission-id": `tid-${Math.random().toString(36).slice(2)}`,
      "paypal-transmission-time": new Date().toISOString(),
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
      "paypal-auth-algo": "SHA256withRSA",
    },
    body: JSON.stringify(body),
  });
}

function captureEvent(orderId: string, eventId: string, at: Date, customId?: string) {
  return {
    id: eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    create_time: at.toISOString(),
    resource: {
      id: `CAP-${orderId}`,
      status: "COMPLETED",
      ...(customId ? { custom_id: customId } : {}),
      amount: { currency_code: "USD", value: "99.00" },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  };
}

function refundEvent(
  orderId: string,
  eventId: string,
  at: Date,
  opts: { status: string; refunded: string }
) {
  return {
    id: eventId,
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    create_time: at.toISOString(),
    resource: {
      id: "CAP",
      status: opts.status,
      amount: { currency_code: "USD", value: "99.00" },
      seller_receivable_breakdown: { refunded_amount: { value: opts.refunded } },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  };
}

const runSuite = DB_OK ? describe : describe.skip;

runSuite("PayPal Founder Lifetime", () => {
  let freePlanId = "";
  let lifetimePlanId = "";

  beforeAll(async () => {
    installFetchMock();
    await ensurePaddleSchema(prisma);
    await ensurePaymentOrderSchema(prisma);
    for (const p of PLANS) {
      const row = planRow(p);
      await prisma.plan.upsert({
        where: { key: p.key },
        create: { ...row } as never,
        update: row as never,
      });
    }
    await prisma.plan.upsert({
      where: { key: LIFETIME_PLAN.key },
      create: { ...planRow(LIFETIME_PLAN), isDemo: false } as never,
      update: planRow(LIFETIME_PLAN) as never,
    });
    freePlanId = (await prisma.plan.findUnique({ where: { key: "free" } }))!.id;
    lifetimePlanId = (await prisma.plan.findUnique({ where: { key: "lifetime" } }))!.id;
    auth = await import("@/lib/auth");
  });

  afterAll(async () => {
    await prisma.paymentOrder.deleteMany({ where: { user: { email: { startsWith: stamp } } } });
    await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: stamp } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
    await vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    jar.clear();
    paypalConfig = {};
    lastCreatePayload = null;
    sentEmails.length = 0;
  });

  async function makeUser(label: string, opts?: { verified?: boolean }): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `${stamp}-${label}@example.com`,
        name: `User ${label}`,
        passwordHash: "x",
        planId: freePlanId,
        emailVerifiedAt: opts?.verified === false ? null : new Date(),
      },
    });
    return u.id;
  }

  it("lifetime plan is hidden from the public list and separate from PLANS", async () => {
    const { UNAVAILABLE_PLAN_KEYS } = await import("@/lib/plans");
    expect(UNAVAILABLE_PLAN_KEYS).toContain("lifetime");
    expect(PLANS.some((p) => p.key === "lifetime")).toBe(false);
    const row = await prisma.plan.findUnique({ where: { key: "lifetime" } });
    expect(row?.billingPeriod).toBe("LIFETIME");
    expect(row?.priceCents).toBeGreaterThan(0);
  });

  it("missing credential turns the feature off and create-order returns 503", async () => {
    const uid = await makeUser("noconfig");
    await auth.createSession(uid);
    const original = process.env.PAYPAL_CLIENT_SECRET;
    process.env.PAYPAL_CLIENT_SECRET = "";
    try {
      const { POST } = (await import("@/app/api/billing/paypal/create-order/route")) as unknown as Route;
      const res = await POST(new Request("http://localhost/x", { method: "POST" }));
      expect(res.status).toBe(503);
    } finally {
      process.env.PAYPAL_CLIENT_SECRET = original;
    }
  });

  it("billing disabled: no order is created", async () => {
    const uid = await makeUser("disabled");
    await auth.createSession(uid);
    const original = process.env.BILLING_ENABLED;
    process.env.BILLING_ENABLED = "false";
    try {
      const { POST } = (await import("@/app/api/billing/paypal/create-order/route")) as unknown as Route;
      const res = await POST(new Request("http://localhost/x", { method: "POST" }));
      expect(res.status).toBe(503);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      process.env.BILLING_ENABLED = original;
    }
  });

  it("LIFETIME_MAX_GRANTS=0 disables grants", async () => {
    const original = process.env.LIFETIME_MAX_GRANTS;
    process.env.LIFETIME_MAX_GRANTS = "0";
    try {
      const { lifetimeGrantAvailable } = await import("@/lib/paypal-billing");
      expect(await lifetimeGrantAvailable()).toBe(false);
    } finally {
      process.env.LIFETIME_MAX_GRANTS = original;
    }
  });

  it("anonymous and unverified callers cannot create an order", async () => {
    const { POST } = (await import("@/app/api/billing/paypal/create-order/route")) as unknown as Route;
    expect((await POST(new Request("http://localhost/x", { method: "POST" }))).status).toBe(401);

    const uid = await makeUser("unverified", { verified: false });
    await auth.createSession(uid);
    expect((await POST(new Request("http://localhost/x", { method: "POST" }))).status).toBe(403);
  });

  it("create-order ignores any client-sent amount and tags custom_id with the user", async () => {
    const uid = await makeUser("create");
    await auth.createSession(uid);
    const { POST } = (await import("@/app/api/billing/paypal/create-order/route")) as unknown as Route;
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountMinor: 1, currency: "EUR" }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { orderId: string; currency: string };
    expect(json.currency).toBe("USD");
    const pu = (lastCreatePayload?.purchase_units as Array<Record<string, unknown>>)[0];
    expect(pu.custom_id).toBe(uid);
    expect((pu.amount as { value: string }).value).toBe("99.00");
    expect((pu.amount as { currency_code: string }).currency_code).toBe("USD");
  });

  it("capture-order rejects another user's order (404)", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    const order = await prisma.paymentOrder.create({
      data: {
        userId: owner,
        provider: "paypal",
        providerOrderId: `${stamp}-owner-order`,
        status: "created",
        amountMinor: 9900,
        currency: "USD",
      },
    });
    await auth.createSession(other);
    const { POST } = (await import("@/app/api/billing/paypal/capture-order/route")) as unknown as Route;
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.providerOrderId }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("webhook: invalid signature fails closed (400) and grants nothing", async () => {
    const uid = await makeUser("badsig");
    const orderId = `${stamp}-badsig-order`;
    await prisma.paymentOrder.create({
      data: { userId: uid, provider: "paypal", providerOrderId: orderId, status: "created", amountMinor: 9900, currency: "USD" },
    });
    paypalConfig.verifyStatus = "FAILURE";
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    const res = await POST(
      webhookRequest(captureEvent(orderId, `${stamp}-evt-bad`, new Date()))
    );
    expect(res.status).toBe(400);
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(0);
  });

  it("webhook: a completed capture grants lifetime exactly once (replay idempotent)", async () => {
    const uid = await makeUser("grant");
    const orderId = `${stamp}-grant-order`;
    await prisma.paymentOrder.create({
      data: { userId: uid, provider: "paypal", providerOrderId: orderId, status: "created", amountMinor: 9900, currency: "USD" },
    });
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    const event = captureEvent(orderId, `${stamp}-evt-grant`, new Date());
    expect((await POST(webhookRequest(event))).status).toBe(200);
    expect((await POST(webhookRequest(event))).status).toBe(200);

    const subs = await prisma.subscription.findMany({ where: { userId: uid, status: "lifetime" } });
    expect(subs).toHaveLength(1);
    expect(subs[0].planId).toBe(lifetimePlanId);
    expect(sentEmails.filter((e) => e === `${stamp}-grant@example.com`)).toHaveLength(1);

    const { getEntitlements } = await import("@/lib/plans");
    const user = (await prisma.user.findUnique({ where: { id: uid } }))!;
    const ent = await getEntitlements(user);
    expect(ent.isLifetime).toBe(true);
    expect(ent.planKey).toBe("lifetime");
    // Same limits / quotas as Pro.
    expect(ent.maxVehicles).toBe(5);
    expect(ent.maxTripsPerMonth).toBe(500);
    expect(ent.maxExpensesPerMonth).toBe(1000);
  });

  it("webhook: unknown order is audited and answered 200 (never granted)", async () => {
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    const res = await POST(
      webhookRequest(captureEvent(`${stamp}-missing`, `${stamp}-evt-missing`, new Date()))
    );
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "paypal.webhook.unknown_order", metadata: { contains: `${stamp}-missing` } },
    });
    expect(audit).toBeTruthy();
  });

  it("webhook: out-of-order older event after a newer one is ignored", async () => {
    const uid = await makeUser("ooo");
    const orderId = `${stamp}-ooo-order`;
    await prisma.paymentOrder.create({
      data: { userId: uid, provider: "paypal", providerOrderId: orderId, status: "created", amountMinor: 9900, currency: "USD" },
    });
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    // A REFUND first (sets lastEventAt = newer)â€¦
    await POST(
      webhookRequest(
        refundEvent(orderId, `${stamp}-evt-newer`, new Date("2026-10-18T12:00:00Z"), {
          status: "REFUNDED",
          refunded: "99.00",
        })
      )
    );
    // â€¦then an older COMPLETED that must be ignored.
    await POST(
      webhookRequest(captureEvent(orderId, `${stamp}-evt-older`, new Date("2026-10-18T10:00:00Z")))
    );
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(0);
  });

  it("webhook: full refund revokes; partial refund keeps access", async () => {
    const uid = await makeUser("refund");
    const orderId = `${stamp}-refund-order`;
    await prisma.paymentOrder.create({
      data: { userId: uid, provider: "paypal", providerOrderId: orderId, status: "created", amountMinor: 9900, currency: "USD" },
    });
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    await POST(
      webhookRequest(captureEvent(orderId, `${stamp}-evt-r1`, new Date("2026-10-18T10:00:00Z")))
    );
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(1);

    // Partial refund: access kept, order marked partially_refunded.
    const partial = refundEvent(orderId, `${stamp}-evt-partial`, new Date("2026-10-18T11:00:00Z"), {
      status: "PARTIALLY_REFUNDED",
      refunded: "50.00",
    });
    expect((await POST(webhookRequest(partial))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(1);
    const afterPartial = await prisma.paymentOrder.findUnique({ where: { providerOrderId: orderId } });
    expect(afterPartial?.status).toBe("partially_refunded");

    // Full refund: access revoked, user dropped to Free.
    const full = refundEvent(orderId, `${stamp}-evt-full`, new Date("2026-10-18T12:00:00Z"), {
      status: "REFUNDED",
      refunded: "99.00",
    });
    expect((await POST(webhookRequest(full))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: uid } }))?.planId).toBe(freePlanId);
  });

  it("webhook: reversal revokes lifetime access", async () => {
    const uid = await makeUser("reversal");
    const orderId = `${stamp}-rev-order`;
    await prisma.paymentOrder.create({
      data: { userId: uid, provider: "paypal", providerOrderId: orderId, status: "created", amountMinor: 9900, currency: "USD" },
    });
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    await POST(
      webhookRequest(captureEvent(orderId, `${stamp}-evt-rev1`, new Date("2026-10-18T10:00:00Z")))
    );
    const reversed = {
      id: `${stamp}-evt-reversed`,
      event_type: "PAYMENT.CAPTURE.REVERSED",
      create_time: new Date("2026-10-18T11:00:00Z").toISOString(),
      resource: {
        id: "CAP",
        status: "REVERSED",
        amount: { currency_code: "USD", value: "99.00" },
        supplementary_data: { related_ids: { order_id: orderId } },
      },
    };
    expect((await POST(webhookRequest(reversed))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(0);
  });

  it("webhook: custom_id mismatch is refused", async () => {
    const uid = await makeUser("mismatch");
    const orderId = `${stamp}-mismatch-order`;
    await prisma.paymentOrder.create({
      data: { userId: uid, provider: "paypal", providerOrderId: orderId, status: "created", amountMinor: 9900, currency: "USD" },
    });
    const { POST } = (await import("@/app/api/paypal/webhook/route")) as unknown as Route;
    const event = captureEvent(orderId, `${stamp}-evt-mismatch`, new Date(), "someone-else");
    expect((await POST(webhookRequest(event))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { userId: uid, status: "lifetime" } })).toBe(0);
  });

  it("cap race: two concurrent grants never exceed the cap", async () => {
    const original = process.env.LIFETIME_MAX_GRANTS;
    try {
      const before = await prisma.paymentOrder.count({
        where: { provider: "paypal", status: { in: ["captured", "partially_refunded"] } },
      });
      // One slot left, globally.
      process.env.LIFETIME_MAX_GRANTS = String(before + 1);

      const uid = await makeUser("cap");
      const o1 = `${stamp}-cap-1`;
      const o2 = `${stamp}-cap-2`;
      await prisma.paymentOrder.createMany({
        data: [
          { userId: uid, provider: "paypal", providerOrderId: o1, status: "created", amountMinor: 9900, currency: "USD" },
          { userId: uid, provider: "paypal", providerOrderId: o2, status: "created", amountMinor: 9900, currency: "USD" },
        ],
      });

      const { grantLifetime } = await import("@/lib/paypal-billing");
      const [a, b] = await Promise.all([
        grantLifetime({ orderId: o1, captureId: "c1", eventAt: new Date() }),
        grantLifetime({ orderId: o2, captureId: "c2", eventAt: new Date() }),
      ]);
      expect([a, b].filter((r) => r.granted)).toHaveLength(1);

      const claimed = await prisma.paymentOrder.count({
        where: { providerOrderId: { in: [o1, o2] }, status: { in: ["captured", "partially_refunded"] } },
      });
      expect(claimed).toBe(1);
    } finally {
      process.env.LIFETIME_MAX_GRANTS = original;
    }
  });
});
