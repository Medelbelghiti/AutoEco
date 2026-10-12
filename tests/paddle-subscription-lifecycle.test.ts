/**
 * Paddle subscription lifecycle (Task 2).
 *
 * `subscription.activated`, `subscription.paused` and `subscription.resumed`
 * are the AUTHORITATIVE notifications for those status changes — Paddle does
 * NOT guarantee a companion `subscription.updated` (it "typically follows"
 * activation, and is only emitted when a pause/resume is *scheduled*). The
 * webhook must therefore apply them itself, as STATUS-ONLY changes:
 *
 *   - `paused`  → status becomes `paused`, access ends (user downgraded when
 *                 no other subscription is active);
 *   - `activated` / `resumed` → status becomes `active`, access restored;
 *   - none of them may fire purchase side effects (payment-success email /
 *     notification / `subscription_created` analytic) — a pause is not a sale;
 *   - the out-of-order guard is reused, and `lifetime` / `canceled` rows are
 *     never mutated.
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

const SECRET = "pdl_test_webhook_secret_for_lifecycle";

process.env.PADDLE_WEBHOOK_SECRET = SECRET;

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
  return JSON.stringify({ event_id: eventId, event_type: eventType, occurred_at: occurredAt, notification_id: `ntf_${eventId}`, data });
}

/** A subscription lifecycle payload for `subId`. */
function subEvent(
  eventId: string,
  eventType: "subscription.activated" | "subscription.paused" | "subscription.resumed",
  subId: string,
  status: string,
  occurredAt: string
): string {
  return payload(eventId, eventType, {
    id: `sub_${subId}`,
    status,
    customer_id: "ctm_p3",
    subscription_id: subId,
    custom_data: { userId },
    current_billing_period: { starts_at: "2026-11-01T00:00:00.000Z", ends_at: "2026-12-01T00:00:00.000Z" },
    next_billed_at: "2026-12-01T00:00:00.000Z",
  }, occurredAt);
}

async function post(body: string): Promise<Response> {
  return route!.POST(new Request("https://autoeco.test/api/paddle/webhook", {
    method: "POST",
    headers: { "paddle-signature": sign(body), "content-type": "application/json" },
    body,
  }));
}

async function seedSub(subId: string, status: string, planId: string, lastEventAt: string): Promise<void> {
  await prisma.subscription.deleteMany({ where: { paddleSubscriptionId: subId } });
  await prisma.subscription.create({
    data: {
      userId,
      planId,
      status,
      paddleSubscriptionId: subId,
      currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
      currentPeriodEnd: status === "paused" ? null : new Date("2026-12-01T00:00:00.000Z"),
      lastEventAt: new Date(lastEventAt),
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { planId } });
}

async function subFor(subId: string) {
  return prisma.subscription.findUnique({ where: { paddleSubscriptionId: subId } });
}

async function userPlan(): Promise<string | null> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { planId: true } })).planId;
}

async function auditActionsLike(needle: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({ where: { metadata: { contains: needle } }, select: { action: true } });
  return rows.map((r) => r.action);
}

const run = DB_OK ? it : it.skip;

describe("Paddle subscription lifecycle (activated / paused / resumed)", () => {
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
    proPlanId = (await prisma.plan.findUniqueOrThrow({ where: { key: "pro" } })).id;
    const user = await prisma.user.create({
      data: {
        email: "lifecycle@autoeco.test",
        passwordHash: "not-a-real-hash",
        name: "Lifecycle Tester",
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
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { metadata: { contains: "p3_" } } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookSideEffect" WHERE "eventId" LIKE 'p3_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "WebhookEvent" WHERE "eventId" LIKE 'p3_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Subscription" WHERE "userId" = '${userId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "userId" = '${userId}' OR "metadata" LIKE '%p3_%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${userId}'`);
    await prisma.$disconnect();
  });

  run("paused revokes access and downgrades the user when nothing else is active", async () => {
    await seedSub("sub_p3_paused", "active", proPlanId, "2026-11-01T00:00:00.000Z");

    const body = subEvent("p3_paused", "subscription.paused", "sub_p3_paused", "paused", "2026-11-15T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    const sub = await subFor("sub_p3_paused");
    expect(sub!.status).toBe("paused");
    expect(sub!.currentPeriodEnd).toBeNull();
    expect(sub!.lastEventAt?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(await userPlan()).toBe(freePlanId);
  });

  run("paused fires no purchase side effects", async () => {
    await seedSub("sub_p3_noeffect", "active", proPlanId, "2026-11-01T00:00:00.000Z");

    const body = subEvent("p3_noeffect", "subscription.paused", "sub_p3_noeffect", "paused", "2026-11-16T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    expect(await prisma.notification.count({ where: { userId } })).toBe(0);
    expect(await prisma.webhookSideEffect.count({ where: { eventId: "p3_noeffect" } })).toBe(0);
    expect(await auditActionsLike("p3_noeffect")).toContain("paddle.subscription.lifecycle");
  });

  run("resumed restores active status, the billing period and the paid plan", async () => {
    await seedSub("sub_p3_resume", "paused", proPlanId, "2026-11-16T00:00:00.000Z");
    // Simulate the user having been downgraded while paused.
    await prisma.user.update({ where: { id: userId }, data: { planId: freePlanId } });

    const body = subEvent("p3_resume", "subscription.resumed", "sub_p3_resume", "active", "2026-11-20T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    const sub = await subFor("sub_p3_resume");
    expect(sub!.status).toBe("active");
    expect(sub!.currentPeriodEnd?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(sub!.canceledAt).toBeNull();
    expect(await userPlan()).toBe(proPlanId);
    expect(await prisma.notification.count({ where: { userId } })).toBe(0);
    expect(await prisma.webhookSideEffect.count({ where: { eventId: "p3_resume" } })).toBe(0);
  });

  run("activated restores active status and the paid plan", async () => {
    await seedSub("sub_p3_activated", "paused", proPlanId, "2026-11-16T00:00:00.000Z");
    await prisma.user.update({ where: { id: userId }, data: { planId: freePlanId } });

    const body = subEvent("p3_activated", "subscription.activated", "sub_p3_activated", "active", "2026-11-25T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    const sub = await subFor("sub_p3_activated");
    expect(sub!.status).toBe("active");
    expect(await userPlan()).toBe(proPlanId);
    // Activation is not a purchase: no payment-success email/notification.
    expect(await prisma.notification.count({ where: { userId } })).toBe(0);
    expect(await prisma.webhookSideEffect.count({ where: { eventId: "p3_activated" } })).toBe(0);
  });

  run("paused keeps the paid plan when another subscription is still active", async () => {
    await seedSub("sub_p3_multi", "active", proPlanId, "2026-11-01T00:00:00.000Z");
    await prisma.subscription.create({
      data: {
        userId,
        planId: proPlanId,
        status: "active",
        paddleSubscriptionId: "sub_p3_multi_other",
        currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
        lastEventAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    });

    const body = subEvent("p3_multi", "subscription.paused", "sub_p3_multi", "paused", "2026-11-18T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    expect((await subFor("sub_p3_multi"))!.status).toBe("paused");
    expect(await userPlan()).toBe(proPlanId);
  });

  run("an out-of-order (stale) paused event is ignored", async () => {
    await seedSub("sub_p3_stale", "active", proPlanId, "2026-12-01T00:00:00.000Z");

    const body = subEvent("p3_stale", "subscription.paused", "sub_p3_stale", "paused", "2026-11-15T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    const sub = await subFor("sub_p3_stale");
    expect(sub!.status).toBe("active");
    expect(await userPlan()).toBe(proPlanId);
    expect(await auditActionsLike("p3_stale")).toContain("paddle.webhook.stale_event_ignored");
  });

  run("a canceled subscription is never resurrected by activated/resumed", async () => {
    await seedSub("sub_p3_canceled", "canceled", proPlanId, "2026-11-01T00:00:00.000Z");
    await prisma.user.update({ where: { id: userId }, data: { planId: freePlanId } });

    const body = subEvent("p3_revive", "subscription.resumed", "sub_p3_canceled", "active", "2026-11-25T00:00:00.000Z");
    expect((await post(body)).status).toBe(200);

    const sub = await subFor("sub_p3_canceled");
    expect(sub!.status).toBe("canceled");
    expect(await userPlan()).toBe(freePlanId);
    expect(await auditActionsLike("p3_revive")).toContain("paddle.webhook.lifecycle_ignored_terminal");
  });
});
