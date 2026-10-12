/**
 * Lifetime price removal + unmapped price handling (Task 3).
 *
 * Lifetime is intentionally NOT sold (see docs/LAUNCH_STATUS.md): there is no
 * `PADDLE_LIFETIME_PRICE_ID`, no lifetime price alias, and no lifetime plan.
 * A subscription/transaction whose price id does not map to any of our plans
 * (including a former lifetime price id) must:
 *   - NOT throw and NOT be silently ignored — write an audit-log entry
 *     (event id / price id / transaction id) and return 200 so Paddle does not
 *     retry endlessly;
 *   - NOT change any entitlement.
 *
 * The `lifetime` subscription STATUS itself is still understood: pre-existing
 * `lifetime` rows keep getting `pro_plus` entitlements.
 *
 * Drives the real webhook route (signature included) against the real DB.
 * Skipped (not failed) when DATABASE_URL is not local — see ./\_dbGuard.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensurePaddleSchema } from "./_ensureSchema";
import { DB_OK } from "./_dbGuard";
import { PLANS, planRow } from "../prisma/plans.data";

const prisma = new PrismaClient();

const SECRET = "pdl_test_webhook_secret_for_lifetime_audit";
const PRO_PRICE = "pri_paddle_pro_lifetime_audit";

process.env.PADDLE_WEBHOOK_SECRET = SECRET;
process.env.PADDLE_PRO_PRICE_ID = PRO_PRICE;

type WebhookRoute = { POST: (req: Request) => Promise<Response> };
let route: WebhookRoute | null = null;

let userId = "";
let freePlanId = "";
let proPlanId = "";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
}

function payload(eventId: string, eventType: string, data: Record<string, unknown>, occurredAt: string): string {
  return JSON.stringify({ event_id: eventId, event_type: eventType, occurred_at: occurredAt, data });
}

async function post(body: string): Promise<Response> {
  return route!.POST(new Request("https://autoeco.test/api/paddle/webhook", {
    method: "POST",
    headers: { "paddle-signature": sign(body), "content-type": "application/json" },
    body,
  }));
}

async function auditActionsLike(needle: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({ where: { metadata: { contains: needle } }, select: { action: true } });
  return rows.map((r) => r.action);
}

async function userPlan(): Promise<string | null> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { planId: true } })).planId;
}

const run = DB_OK ? it : it.skip;

describe("Lifetime price removal + unmapped price handling", () => {
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
    proPlanId = (await prisma.plan.findUniqueOrThrow({ where: { key: "pro_plus" } })).id;
    const user = await prisma.user.create({
      data: {
        email: "lifetime-audit@autoeco.test",
        passwordHash: "not-a-real-hash",
        name: "Lifetime Audit",
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
        planId: freePlanId,
      },
    });
    userId = user.id;
    route = (await import("@/app/api/paddle/webhook/route")) as unknown as WebhookRoute;
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { planId: freePlanId } });
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "metadata" LIKE '%p4_%'`);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE 'p4_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'p4_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" = '${userId}' OR "metadata" LIKE '%p4_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${userId}'`);
    await prisma.$disconnect();
  });

  run("an unknown price id grants no entitlement and is audited (200)", async () => {
    const body = payload("p4_unknown", "subscription.created", {
      id: "sub_p4_unknown",
      status: "active",
      customer_id: "ctm_p4",
      subscription_id: "sub_p4_unknown",
      custom_data: { userId },
      items: [{ price: { id: "pri_p4_not_ours" } }],
    }, "2026-10-06T10:00:00.000Z");

    expect((await post(body)).status).toBe(200);

    // No entitlement change: the plan pointer is untouched and no subscription was created.
    expect(await userPlan()).toBe(freePlanId);
    expect(await prisma.subscription.count({ where: { paddleSubscriptionId: "sub_p4_unknown" } })).toBe(0);
    // Flagged for the owner instead of being silently swallowed.
    expect(await auditActionsLike("p4_unknown")).toContain("paddle.webhook.unmapped_price_id");
  });

  run("the former lifetime price id is now treated as unknown", async () => {
    const body = payload("p4_lifetime", "subscription.created", {
      id: "sub_p4_lifetime",
      status: "active",
      customer_id: "ctm_p4",
      subscription_id: "sub_p4_lifetime",
      custom_data: { userId },
      items: [{ price: { id: "pri_lifetime_legacy" } }],
    }, "2026-10-06T11:00:00.000Z");

    expect((await post(body)).status).toBe(200);

    expect(await userPlan()).toBe(freePlanId);
    expect(await prisma.subscription.count({ where: { paddleSubscriptionId: "sub_p4_lifetime" } })).toBe(0);
    expect(await auditActionsLike("p4_lifetime")).toContain("paddle.webhook.unmapped_price_id");
  });

  run("an unknown-price transaction is audited, not thrown (200)", async () => {
    const body = payload("p4_txn", "transaction.completed", {
      id: "txn_p4_unknown",
      status: "completed",
      customer_id: "ctm_p4",
      custom_data: { userId },
      currency_code: "USD",
      details: { totals: { grand_total: "999", currency_code: "USD" } },
      items: [{ price: { id: "pri_p4_not_ours" } }],
    }, "2026-10-06T11:00:00.000Z");

    expect((await post(body)).status).toBe(200);
    expect(await auditActionsLike("p4_unknown")).toContain("paddle.webhook.unmapped_price_id");
    expect(await userPlan()).toBe(freePlanId);
  });

  run("a known price id still grants its plan (control)", async () => {
    const body = payload("p4_known", "subscription.created", {
      id: "sub_p4_known",
      status: "active",
      customer_id: "ctm_p4",
      subscription_id: "sub_p4_known",
      custom_data: { userId },
      items: [{ price: { id: PRO_PRICE } }],
      current_billing_period: { starts_at: "2026-10-06T00:00:00.000Z", ends_at: "2026-11-06T00:00:00.000Z" },
    }, "2026-10-06T11:00:00.000Z");

    expect((await post(body)).status).toBe(200);
    // The known pro price grants the `pro` plan (not pro_plus).
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { paddleSubscriptionId: "sub_p4_known" } });
    expect(sub.status).toBe("active");
    expect(await userPlan()).not.toBe(freePlanId);
  });

  run("a pre-existing lifetime subscription row still gets pro_plus entitlements", async () => {
    await prisma.subscription.create({
      data: {
        userId,
        planId: proPlanId,
        status: "lifetime",
        paddleSubscriptionId: "sub_p4_legacy_lifetime",
        lastEventAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const { getEntitlements } = await import("@/lib/plans");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ent = await getEntitlements(user);
    expect(ent.subscriptionStatus).toBe("lifetime");
    expect(ent.planKey).toBe("pro_plus");
    expect(ent.currentPeriodEnd).toBeNull();
  });
});
