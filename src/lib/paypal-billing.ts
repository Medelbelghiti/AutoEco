/**
 * Founder Lifetime grant / refund state — server side only.
 *
 * A lifetime purchase is represented by the dedicated `lifetime` Plan row
 * (billingPeriod = "LIFETIME") referenced by a normal `Subscription` with
 * status `lifetime`. That means `getEntitlements()` and every quota check
 * keep working with no special-casing, and the existing cron expiry ignores
 * it. `PaymentOrder` is the idempotency anchor: a grant is only ever issued
 * by claiming a `created`/`pending` order row, so a redelivered webhook or a
 * double capture can never grant twice.
 *
 * The cap is enforced under a row lock on the lifetime Plan row so two
 * concurrent webhooks cannot both grant the last slot.
 */
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { lifetimeMaxGrants } from "./paypal";
import { tryClaimSideEffect } from "./webhook-state";
import { createNotification } from "./notifications";
import { sendEmail, tplPaymentSuccess } from "./email";
import { coerceLocale } from "./i18n";
import { trackEvent } from "./analytics";

export const LIFETIME_PLAN_KEY = "lifetime";

/** Order states that represent a live, cap-consuming grant. */
export const ACTIVE_GRANT_STATUSES = ["captured", "partially_refunded"] as const;

export async function getLifetimePlan(): Promise<{ id: string; name: string } | null> {
  return db.plan.findUnique({
    where: { key: LIFETIME_PLAN_KEY },
    select: { id: true, name: true },
  });
}

export async function countLifetimeGrants(): Promise<number> {
  return db.paymentOrder.count({
    where: { provider: "paypal", status: { in: [...ACTIVE_GRANT_STATUSES] } },
  });
}

/**
 * True when a new grant could be issued right now: a positive cap is
 * configured and fewer than `cap` grants exist. When the cap is 0 the feature
 * is considered off, so this returns false and the UI hides the card.
 */
export async function lifetimeGrantAvailable(): Promise<boolean> {
  const cap = lifetimeMaxGrants();
  if (cap <= 0) return false;
  return (await countLifetimeGrants()) < cap;
}

export async function isLifetimeUser(userId: string): Promise<boolean> {
  const n = await db.subscription.count({ where: { userId, status: "lifetime" } });
  return n > 0;
}

export type GrantOutcome =
  | { granted: true; userId: string; planName: string }
  | {
      granted: false;
      reason: "no-plan" | "unknown-order" | "already-granted" | "cap-reached" | "already-lifetime";
    };

/**
 * Grant lifetime access for a captured order. Idempotent: once the order is
 * `captured` (or later), a repeat call is a no-op. Safe under concurrency —
 * the lifetime Plan row is locked, then the cap is re-counted, then the order
 * is claimed with a conditional `updateMany`.
 */
export async function grantLifetime(params: {
  orderId: string;
  captureId?: string | null;
  eventAt: Date;
}): Promise<GrantOutcome> {
  return db.$transaction(async (tx) => {
    // Serialise concurrent grants on the lifetime plan row.
    const lock = await tx.$queryRaw<Array<{ id: string; name: string }>>(
      Prisma.sql`SELECT "id","name" FROM "Plan" WHERE "key" = ${LIFETIME_PLAN_KEY} FOR UPDATE`
    );
    if (lock.length === 0) return { granted: false, reason: "no-plan" } as const;
    const plan = lock[0];

    const order = await tx.paymentOrder.findUnique({ where: { providerOrderId: params.orderId } });
    if (!order) return { granted: false, reason: "unknown-order" } as const;
    if (order.status === "captured" || order.status === "partially_refunded") {
      return { granted: false, reason: "already-granted" } as const;
    }

    const cap = lifetimeMaxGrants();
    if (cap <= 0) return { granted: false, reason: "cap-reached" } as const;
    const used = await tx.paymentOrder.count({
      where: { provider: "paypal", status: { in: [...ACTIVE_GRANT_STATUSES] } },
    });
    if (used >= cap) return { granted: false, reason: "cap-reached" } as const;

    const claimed = await tx.paymentOrder.updateMany({
      where: { id: order.id, status: { in: ["created", "pending"] } },
      data: {
        status: "captured",
        capturedAt: params.eventAt,
        lastEventAt: params.eventAt,
        ...(params.captureId ? { providerCaptureId: params.captureId } : {}),
      },
    });
    if (claimed.count === 0) return { granted: false, reason: "already-granted" } as const;

    const existing = await tx.subscription.count({
      where: { userId: order.userId, status: "lifetime" },
    });
    if (existing > 0) return { granted: false, reason: "already-lifetime" } as const;

    await tx.subscription.create({
      data: {
        userId: order.userId,
        planId: plan.id,
        status: "lifetime",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        lastEventAt: params.eventAt,
      },
    });
    await tx.user.update({
      where: { id: order.userId },
      data: { planId: plan.id, trialEndsAt: null, trialUsed: true },
    });
    return { granted: true, userId: order.userId, planName: plan.name } as const;
  });
}

export type RefundOutcome =
  | { revoked: false; reason: "unknown-order" | "partial-recorded" }
  | { revoked: true; reason: "revoked" };

/**
 * Apply a refund/reversal. Full refunds (including reversals) revoke lifetime
 * access and drop the user to Free when nothing else is active. A partial
 * refund records the state and amount but keeps access.
 */
export async function applyRefund(params: {
  orderId: string;
  partial: boolean;
  refundedMinor: number | null;
  eventAt: Date;
}): Promise<RefundOutcome> {
  const outcome = await db.$transaction(async (tx) => {
    const order = await tx.paymentOrder.findUnique({ where: { providerOrderId: params.orderId } });
    if (!order) return { revoked: false, reason: "unknown-order" } as const;

    if (params.partial) {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: order.status === "created" ? "created" : "partially_refunded",
          refundedAt: params.eventAt,
          lastEventAt: params.eventAt,
        },
      });
      return { revoked: false, reason: "partial-recorded" } as const;
    }

    await tx.paymentOrder.update({
      where: { id: order.id },
      data: { status: "refunded", refundedAt: params.eventAt, lastEventAt: params.eventAt },
    });

    const plan = await tx.plan.findUnique({ where: { key: LIFETIME_PLAN_KEY }, select: { id: true } });
    await tx.subscription.updateMany({
      where: { userId: order.userId, status: "lifetime", ...(plan ? { planId: plan.id } : {}) },
      data: { status: "canceled", canceledAt: params.eventAt, lastEventAt: params.eventAt },
    });
    await downgradeToFreeIfInactive(tx, order.userId);
    return { revoked: true, reason: "revoked" } as const;
  });
  return outcome;
}

/**
 * Fire the one-time purchase side effects (notification, email, analytic).
 * Keyed on the ORDER id, not the webhook event id, so it runs exactly once no
 * matter which caller grants first (the capture endpoint or the webhook).
 */
export async function emitLifetimePurchaseEffects(params: {
  orderId: string;
  userId: string;
  planName: string;
}): Promise<void> {
  if (await tryClaimSideEffect(params.orderId, "PAYPAL_LIFETIME_NOTIFICATION")) {
    await createNotification({
      userId: params.userId,
      type: "PAYMENT_SUCCESS",
      title: "Lifetime access active",
      link: "/settings/billing",
    });
  }
  if (await tryClaimSideEffect(params.orderId, "PAYPAL_LIFETIME_EMAIL")) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: { email: true, name: true, locale: true },
    });
    if (user) {
      await sendEmail({
        ...tplPaymentSuccess(user.name, params.planName, coerceLocale(user.locale)),
        to: user.email,
      });
    }
  }
  if (await tryClaimSideEffect(params.orderId, "PAYPAL_LIFETIME_ANALYTICS")) {
    await trackEvent("subscription_created", {
      userId: params.userId,
      metadata: { planKey: LIFETIME_PLAN_KEY, provider: "paypal" },
    });
  }
}

/** Mark a never-captured order as denied. Captured orders are handled by `applyRefund`. */
export async function denyOrder(orderId: string, eventAt: Date): Promise<void> {
  await db.paymentOrder.updateMany({
    where: { providerOrderId: orderId, status: { in: ["created", "pending"] } },
    data: { status: "denied", lastEventAt: eventAt },
  });
}

async function downgradeToFreeIfInactive(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const stillActive = await tx.subscription.count({
    where: { userId, status: { in: ["active", "trialing", "lifetime"] } },
  });
  if (stillActive > 0) return;
  const free = await tx.plan.findFirst({ where: { key: "free" }, select: { id: true } });
  if (free) await tx.user.update({ where: { id: userId }, data: { planId: free.id } });
}
