/**
 * Whop billing, end to end against the real database.
 *
 * The webhook is driven through the real route handler with real Standard
 * Webhooks signatures and payloads shaped like Whop's v1 webhooks, so these
 * tests fail if the handler regresses. `fetch` is mocked: the Whop API is
 * never contacted.
 *
 * Skipped (not failed) when DATABASE_URL is not local — see ./_dbGuard.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ensurePaddleSchema } from "./_ensureSchema";
import { DB_OK } from "./_dbGuard";
import { PLANS, LIFETIME_PLAN, planRow } from "../prisma/plans.data";
import { signWhopPayload } from "@/lib/whop";

const prisma = new PrismaClient();

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const emails: Array<{ to: string; subject?: string }> = [];
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (opts: { to: string; subject?: string }) => {
      emails.push({ to: opts.to, subject: opts.subject });
      return { ok: true } as never;
    }),
  };
});

const SECRET = "ws_whop_billing_test_secret_0123456789";
const PRO = "plan_test_pro";
const PRO_PLUS = "plan_test_pro_plus";
const LIFE = "plan_test_lifetime";
const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "whop-billing-auth-secret-0123456789abcdef0123";
process.env.WHOP_WEBHOOK_SECRET = SECRET;
process.env.WHOP_API_KEY = "whop_test_api_key";
process.env.WHOP_COMPANY_ID = "biz_test";
process.env.WHOP_PRO_PLAN_ID = PRO;
process.env.WHOP_PRO_PLUS_PLAN_ID = PRO_PLUS;
process.env.WHOP_LIFETIME_PLAN_ID = LIFE;
process.env.LIFETIME_MAX_GRANTS = "100000";

type Route = { POST: (req: Request, ctx?: unknown) => Promise<Response> };
let webhook: Route;

/** Every fetch the code under test makes to Whop. */
let apiCalls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
let apiResponder: (url: string, method: string) => { status: number; json: unknown } = () => ({ status: 200, json: {} });

const originalFetch = globalThis.fetch;
function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    apiCalls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const r = apiResponder(url, method);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json } as Response;
  }) as typeof fetch;
}

let seq = 0;
async function deliver(type: string, data: Record<string, unknown>, opts: { id?: string; secret?: string } = {}): Promise<Response> {
  const id = opts.id ?? `msg_${RUN}_${++seq}`;
  const body = JSON.stringify({ id, type, api_version: "v1", timestamp: new Date().toISOString(), account_id: "biz_test", data });
  const ts = String(Math.floor(Date.now() / 1000));
  return webhook.POST(
    new Request("https://autoeco.test/api/whop/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": signWhopPayload(body, id, ts, opts.secret ?? SECRET),
      },
      body,
    })
  );
}

function membership(id: string, userId: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "active",
    variant_id: PRO,
    user_id: `user_${RUN}_${userId ?? "x"}`,
    product_id: "prod_test",
    cancel_at_period_end: false,
    current_period_start: "2026-11-01T00:00:00.000Z",
    current_period_end: "2026-12-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:01.000Z",
    created_at: "2026-11-01T00:00:00.000Z",
    metadata: userId ? { userId, planKey: "pro" } : {},
    ...over,
  };
}

function payment(id: string, membershipId: string, userId: string | null, amount: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "paid",
    substatus: "succeeded",
    membership_id: membershipId,
    variant_id: PRO,
    user: { id: `user_${RUN}_${userId ?? "x"}`, username: "buyer", name: null },
    total: { amount, currency: "usd", decimals: 2, display_decimals: 2 },
    currency: "usd",
    paid_at: "2026-11-01T00:00:02.000Z",
    created_at: "2026-11-01T00:00:02.000Z",
    billing_reason: "subscription_create",
    metadata: userId ? { userId, planKey: "pro" } : {},
    ...over,
  };
}

const userIds: string[] = [];
async function makeUser(tag: string): Promise<string> {
  const free = await prisma.plan.findUniqueOrThrow({ where: { key: "free" } });
  const u = await prisma.user.create({
    data: {
      email: `whop-${tag}-${RUN}@autoeco.test`,
      passwordHash: "not-a-real-hash",
      name: `Whop ${tag}`,
      currency: "USD",
      distanceUnit: "km",
      fuelUnit: "L_PER_100KM",
      planId: free.id,
      emailVerifiedAt: new Date(),
    },
  });
  userIds.push(u.id);
  return u.id;
}

async function subOf(membershipId: string) {
  return prisma.subscription.findUnique({ where: { whopMembershipId: membershipId }, include: { plan: true } });
}
async function userPlanKey(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { plan: true } });
  return u.plan?.key ?? null;
}

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

runSuite("Whop billing (real DB)", () => {
  beforeAll(async () => {
    await ensurePaddleSchema(prisma);
    for (const p of [...PLANS, LIFETIME_PLAN]) {
      const row = planRow(p);
      const { key, ...fields } = row;
      await prisma.plan.upsert({
        where: { key: key as string },
        create: { ...row, isDemo: false } as never,
        update: { ...fields, isDemo: false } as never,
      });
    }
    webhook = (await import("@/app/api/whop/webhook/route")) as unknown as Route;
    mockFetch();
  });

  beforeEach(() => {
    apiCalls = [];
    apiResponder = () => ({ status: 200, json: {} });
    emails.length = 0;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    const ids = userIds.map((i) => `'${i}'`).join(",") || "''";
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE 'msg_${RUN}%' OR "eventId" LIKE 'whop:mem_${RUN}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'msg_${RUN}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "RefundAdjustment" WHERE "transactionId" LIKE 'pay_${RUN}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "userId" IN (${ids})`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "userId" IN (${ids})`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" IN (${ids})`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" IN (${ids})`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Session" WHERE "userId" IN (${ids})`).catch(() => 0);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" IN (${ids})`);
    await prisma.$disconnect();
  });

  run("1. rejects a bad signature (401) and a missing one (400), and grants nothing", async () => {
    const uid = await makeUser("sig");
    const m = `mem_${RUN}_sig`;
    const bad = await deliver("membership.activated", membership(m, uid), { secret: "ws_not_the_secret_000000000000" });
    expect(bad.status).toBe(401);
    const missing = await webhook.POST(new Request("https://autoeco.test/api/whop/webhook", { method: "POST", body: "{}" }));
    expect(missing.status).toBe(400);
    expect(await subOf(m)).toBeNull();
  });

  run("2. membership.activated grants Pro from metadata.userId and retires the trial", async () => {
    const uid = await makeUser("activate");
    await prisma.user.update({ where: { id: uid }, data: { trialEndsAt: new Date(Date.now() + 86_400_000) } });
    const m = `mem_${RUN}_activate`;
    const res = await deliver("membership.activated", membership(m, uid));
    expect(res.status).toBe(200);

    const sub = await subOf(m);
    expect(sub?.status).toBe("active");
    expect(sub?.plan.key).toBe("pro");
    expect(sub?.currentPeriodEnd?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: uid }, include: { plan: true } });
    expect(u.plan?.key).toBe("pro");
    expect(u.trialEndsAt).toBeNull();
    expect(u.trialUsed).toBe(true);
    expect(u.whopUserId).toBe(`user_${RUN}_${uid}`);
  });

  run("3. a retried delivery (same webhook-id) is applied once", async () => {
    const uid = await makeUser("retry");
    const m = `mem_${RUN}_retry`;
    const p = `pay_${RUN}_retry`;
    await deliver("membership.activated", membership(m, uid));
    const id = `msg_${RUN}_retry_payment`;
    const a = await deliver("payment.succeeded", payment(p, m, uid, "6.99"), { id });
    const b = await deliver("payment.succeeded", payment(p, m, uid, "6.99"), { id });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await prisma.invoice.count({ where: { whopPaymentId: p } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: uid, type: "PAYMENT_SUCCESS" } })).toBe(1);
    expect(emails.filter((e) => e.to.includes("retry"))).toHaveLength(1);
  });

  run("4. payment.succeeded records the exact amount in minor units and the real currency", async () => {
    const uid = await makeUser("invoice");
    const m = `mem_${RUN}_invoice`;
    const p = `pay_${RUN}_invoice`;
    await deliver("membership.activated", membership(m, uid));
    await deliver("payment.succeeded", payment(p, m, uid, "19.99", { total: { amount: "19.99", currency: "eur", decimals: 2 }, currency: "eur", variant_id: PRO_PLUS }));
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { whopPaymentId: p } });
    expect(inv.amountCents).toBe(1999);
    expect(inv.currency).toBe("EUR");
    expect(inv.status).toBe("paid");
    expect(inv.whopMembershipId).toBe(m);
    expect(inv.planName).toBe("Pro Plus");
    expect(inv.stripeInvoiceId).toBe(`whop_${p}`);
  });

  run("5. an older update arriving late cannot resurrect a canceled membership", async () => {
    const uid = await makeUser("order");
    const m = `mem_${RUN}_order`;
    await deliver("membership.activated", membership(m, uid, { updated_at: "2026-11-01T00:00:00.000Z" }));
    await deliver("membership.deactivated", membership(m, uid, { status: "canceled", canceled_at: "2026-11-10T00:00:00.000Z", updated_at: "2026-11-10T00:00:00.000Z" }));
    const stale = await deliver("membership.updated", membership(m, uid, { status: "active", updated_at: "2026-11-05T00:00:00.000Z" }));
    expect(stale.status).toBe(200);
    expect((await subOf(m))?.status).toBe("canceled");
    expect(await userPlanKey(uid)).toBe("free");
    const audit = await prisma.auditLog.count({ where: { action: "whop.webhook.stale_event_ignored", createdAt: { gt: new Date(Date.now() - 60_000) } } });
    expect(audit).toBeGreaterThan(0);
  });

  run("6. canceling keeps access until the period end; deactivation downgrades and notifies once", async () => {
    const uid = await makeUser("cancel");
    const m = `mem_${RUN}_cancel`;
    await deliver("membership.activated", membership(m, uid));
    await deliver("membership.updated", membership(m, uid, { status: "canceling", cancel_at_period_end: true, updated_at: "2026-11-02T00:00:00.000Z" }));
    let sub = await subOf(m);
    expect(sub?.status).toBe("active");
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    expect(await userPlanKey(uid)).toBe("pro");

    const ended = membership(m, uid, { status: "canceled", canceled_at: "2026-12-01T00:00:00.000Z", updated_at: "2026-12-01T00:00:00.000Z" });
    await deliver("membership.updated", ended);
    await deliver("membership.deactivated", { ...ended, updated_at: "2026-12-01T00:00:00.000Z" });
    sub = await subOf(m);
    expect(sub?.status).toBe("canceled");
    expect(await userPlanKey(uid)).toBe("free");
    expect(await prisma.notification.count({ where: { userId: uid, type: "SUBSCRIPTION_CANCELED" } })).toBe(1);
  });

  run("7. a plan we do not sell grants nothing and does not fail the webhook", async () => {
    const uid = await makeUser("unmapped");
    const m = `mem_${RUN}_unmapped`;
    const res = await deliver("membership.activated", membership(m, uid, { variant_id: "plan_someone_elses_product" }));
    expect(res.status).toBe(200);
    expect(await subOf(m)).toBeNull();
    expect(await userPlanKey(uid)).toBe("free");
  });

  run("8. an unattributable paid membership fails (500) so Whop retries", async () => {
    const m = `mem_${RUN}_orphan`;
    const res = await deliver("membership.activated", membership(m, null));
    expect(res.status).toBe(500);
    expect(await subOf(m)).toBeNull();
  });

  run("9. a returning customer is matched by their Whop user id without metadata", async () => {
    const uid = await makeUser("returning");
    await deliver("membership.activated", membership(`mem_${RUN}_returning_a`, uid));
    const m2 = `mem_${RUN}_returning_b`;
    await deliver("membership.activated", { ...membership(m2, null), user_id: `user_${RUN}_${uid}`, variant_id: PRO_PLUS });
    const sub = await subOf(m2);
    expect(sub?.userId).toBe(uid);
    expect(sub?.plan.key).toBe("pro_plus");
  });

  run("10. switching plans schedules the previous membership to end, so nobody is billed twice", async () => {
    const uid = await makeUser("switch");
    const oldM = `mem_${RUN}_switch_old`;
    const newM = `mem_${RUN}_switch_new`;
    await deliver("membership.activated", membership(oldM, uid));
    apiCalls = [];
    await deliver("membership.activated", membership(newM, uid, { variant_id: PRO_PLUS }));
    const cancel = apiCalls.find((c) => c.url.endsWith(`/memberships/${oldM}/cancel`));
    expect(cancel?.method).toBe("POST");
    expect(cancel?.body).toEqual({ cancel_at_period_end: true });
    expect((await subOf(oldM))?.cancelAtPeriodEnd).toBe(true);
    expect(await userPlanKey(uid)).toBe("pro_plus");
  });

  run("11. payment.failed marks past_due (never a lifetime grant) and tells the customer", async () => {
    const uid = await makeUser("failed");
    const m = `mem_${RUN}_failed`;
    await deliver("membership.activated", membership(m, uid));
    await deliver("payment.failed", payment(`pay_${RUN}_failed`, m, uid, "6.99", { status: "open", substatus: "failed", updated_at: "2026-12-01T00:00:00.000Z" }));
    expect((await subOf(m))?.status).toBe("past_due");
    expect(await prisma.notification.count({ where: { userId: uid, type: "PAYMENT_FAILED" } })).toBe(1);
  });

  run("12. Founder Lifetime: a completed one-time membership grants lifetime; a full refund revokes it", async () => {
    const uid = await makeUser("lifetime");
    const m = `mem_${RUN}_lifetime`;
    const p = `pay_${RUN}_lifetime`;
    await deliver("membership.activated", membership(m, uid, { variant_id: LIFE, status: "completed", current_period_end: null, metadata: { userId: uid, planKey: "lifetime" } }));
    await deliver("payment.succeeded", payment(p, m, uid, "99.00", { variant_id: LIFE, billing_reason: "one_time" }));
    let sub = await subOf(m);
    expect(sub?.status).toBe("lifetime");
    expect(sub?.currentPeriodEnd).toBeNull();
    expect(await userPlanKey(uid)).toBe("lifetime");

    // A partial refund keeps access.
    await deliver("refund.created", { id: `rfnd_${RUN}_l1`, payment_id: p, status: "succeeded", amount: { amount: "9.00", currency: "usd", decimals: 2 } });
    expect((await subOf(m))?.status).toBe("lifetime");
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { whopPaymentId: p } });
    expect(inv.status).toBe("partially_refunded");
    expect(inv.refundedAmountCents).toBe(900);

    // The rest, delivered twice (created + updated): applied once, revokes.
    const rest = { id: `rfnd_${RUN}_l2`, payment_id: p, status: "succeeded", amount: { amount: "90.00", currency: "usd", decimals: 2 } };
    await deliver("refund.created", rest);
    await deliver("refund.updated", rest);
    inv = await prisma.invoice.findUniqueOrThrow({ where: { whopPaymentId: p } });
    expect(inv.status).toBe("refunded");
    expect(inv.refundedAmountCents).toBe(9900);
    sub = await subOf(m);
    expect(sub?.status).toBe("canceled");
    expect(await userPlanKey(uid)).toBe("free");
    expect(apiCalls.some((c) => c.url.endsWith(`/memberships/${m}/cancel`) && (c.body as { cancel_at_period_end: boolean }).cancel_at_period_end === false)).toBe(true);
  });

  run("13. a pending refund changes nothing; a full refund of an OLDER payment keeps access", async () => {
    const uid = await makeUser("oldrefund");
    const m = `mem_${RUN}_oldrefund`;
    await deliver("membership.activated", membership(m, uid));
    await deliver("payment.succeeded", payment(`pay_${RUN}_old1`, m, uid, "6.99", { paid_at: "2026-10-01T00:00:00.000Z" }));
    await deliver("payment.succeeded", payment(`pay_${RUN}_old2`, m, uid, "6.99", { paid_at: "2026-11-01T00:00:00.000Z" }));

    await deliver("refund.created", { id: `rfnd_${RUN}_pending`, payment_id: `pay_${RUN}_old1`, status: "pending", amount: { amount: "6.99", currency: "usd", decimals: 2 } });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { whopPaymentId: `pay_${RUN}_old1` } })).status).toBe("paid");

    apiCalls = [];
    await deliver("refund.updated", { id: `rfnd_${RUN}_pending`, payment_id: `pay_${RUN}_old1`, status: "succeeded", amount: { amount: "6.99", currency: "usd", decimals: 2 } });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { whopPaymentId: `pay_${RUN}_old1` } })).status).toBe("refunded");
    expect(apiCalls.filter((c) => c.url.includes("/cancel"))).toHaveLength(0);
    expect((await subOf(m))?.status).toBe("active");

    // Refunding the latest payment ends the membership at Whop immediately.
    await deliver("refund.created", { id: `rfnd_${RUN}_latest`, payment_id: `pay_${RUN}_old2`, status: "succeeded", amount: { amount: "6.99", currency: "usd", decimals: 2 } });
    const cancel = apiCalls.find((c) => c.url.endsWith(`/memberships/${m}/cancel`));
    expect(cancel?.body).toEqual({ cancel_at_period_end: false });
  });

  run("14. checkout route: verified user gets a Whop URL; metadata and plan id come from the server", async () => {
    const uid = await makeUser("checkout");
    const auth = await import("@/lib/auth");
    jar.clear();
    await auth.createSession(uid);
    apiResponder = (url) =>
      url.endsWith("/checkout_configurations")
        ? { status: 200, json: { id: "ch_test", purchase_url: "https://whop.com/checkout/ch_test" } }
        : { status: 200, json: {} };
    const { POST } = await import("@/app/api/billing/checkout/route");
    const res = await POST(
      new Request("https://autoeco.test/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planKey: "pro_plus", priceCents: 1 }),
      }),
      undefined
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://whop.com/checkout/ch_test" });
    const call = apiCalls.find((c) => c.url.endsWith("/checkout_configurations"));
    expect(call?.url).toBe("https://sandbox-api.whop.com/api/v1/checkout_configurations");
    expect(call?.headers.Authorization).toBe("Bearer whop_test_api_key");
    expect(call?.headers["Api-Version-Date"]).toBeTruthy();
    const body = call?.body as Record<string, unknown>;
    expect(body.variant_id).toBe(PRO_PLUS);
    expect(body.account_id).toBe("biz_test");
    expect(body.metadata).toMatchObject({ userId: uid, planKey: "pro_plus" });
    expect(String(body.redirect_url)).toMatch(/\/settings\/billing\?checkout=success$/);
  });

  run("15. checkout route refuses unverified emails and existing lifetime holders", async () => {
    const auth = await import("@/lib/auth");
    const { POST } = await import("@/app/api/billing/checkout/route");
    const req = () =>
      new Request("https://autoeco.test/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planKey: "pro" }),
      });

    const unverified = await makeUser("unverified");
    await prisma.user.update({ where: { id: unverified }, data: { emailVerifiedAt: null } });
    jar.clear();
    await auth.createSession(unverified);
    expect((await POST(req(), undefined)).status).toBe(403);

    const lifer = await makeUser("lifer");
    const life = await prisma.plan.findUniqueOrThrow({ where: { key: "lifetime" } });
    await prisma.subscription.create({ data: { userId: lifer, planId: life.id, status: "lifetime" } });
    jar.clear();
    await auth.createSession(lifer);
    apiCalls = [];
    expect((await POST(req(), undefined)).status).toBe(409);
    expect(apiCalls).toHaveLength(0);
  });

  run("16. cancel / resume / portal call Whop for the user's own membership", async () => {
    const uid = await makeUser("selfserve");
    const m = `mem_${RUN}_selfserve`;
    await deliver("membership.activated", membership(m, uid));
    const auth = await import("@/lib/auth");
    jar.clear();
    await auth.createSession(uid);

    apiCalls = [];
    const cancel = await (await import("@/app/api/billing/cancel/route")).POST(
      new Request("https://autoeco.test/api/billing/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atPeriodEnd: true }) }),
      undefined
    );
    expect(cancel.status).toBe(200);
    expect(apiCalls[0]?.url).toMatch(new RegExp(`/memberships/${m}/cancel$`));
    expect(apiCalls[0]?.body).toEqual({ cancel_at_period_end: true });
    expect((await subOf(m))?.cancelAtPeriodEnd).toBe(true);

    apiCalls = [];
    const resume = await (await import("@/app/api/billing/resume/route")).POST(new Request("https://autoeco.test/api/billing/resume", { method: "POST" }), undefined);
    expect(resume.status).toBe(200);
    expect(apiCalls[0]?.method).toBe("PATCH");
    expect(apiCalls[0]?.body).toEqual({ cancel_at_period_end: false });
    expect((await subOf(m))?.cancelAtPeriodEnd).toBe(false);

    apiResponder = () => ({ status: 200, json: { id: m, status: "active", manage_url: "https://whop.com/manage/mem_x", cancel_at_period_end: false } });
    const portal = await (await import("@/app/api/billing/portal/route")).POST(new Request("https://autoeco.test/api/billing/portal", { method: "POST" }), undefined);
    expect(portal.status).toBe(200);
    expect(await portal.json()).toEqual({ url: "https://whop.com/manage/mem_x" });

    // A provider failure is reported, never leaked.
    apiResponder = () => ({ status: 500, json: { error: "internal detail sk_live_xxx" } });
    const failed = await (await import("@/app/api/billing/cancel/route")).POST(
      new Request("https://autoeco.test/api/billing/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atPeriodEnd: false }) }),
      undefined
    );
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("sk_live");
  });
});
