/**
 * POST /api/paddle/webhook
 *
 * Paddle is the production payment provider. The route reuses the
 * existing `WebhookEvent` (with processingToken ownership) and
 * `WebhookSideEffect` (durable side-effect idempotency) protections.
 * NO parallel idempotency mechanism is created.
 *
 * Signature: Paddle Billflow header `Paddle-Signature: ts=...;h1=...`.
 *   h1 = hex(HMAC-SHA256(webhook_secret, ts + "." + raw_body))
 *
 * Production URL (resolved from `NEXT_PUBLIC_APP_URL`):
 *   https://<domain>/api/paddle/webhook
 * Configure in the Paddle dashboard (Developer Tools → Webhooks).
 */
import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { paddleWebhookConfigured, env } from "@/lib/env";
import {
  verifyWebhookSignature,
  planKeyForPriceId,
  paddleAmountToCents,
  normalizeInvoiceCurrency,
  type PaddleWebhookPayload,
  type PaddlePlanKey,
} from "@/lib/paddle";
import { db } from "@/lib/db";
import { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "@/lib/webhook-state";
import { createNotification } from "@/lib/notifications";
import { sendEmail, tplPaymentSuccess, tplPaymentFailed, tplSubscriptionCanceled } from "@/lib/email";
import { trackEvent } from "@/lib/analytics";
import { auditLog } from "@/lib/audit";

export const POST = withErrorHandling(async (req) => {
  if (!paddleWebhookConfigured()) {
    return NextResponse.json({ error: "Paddle webhook is not configured." }, { status: 503 });
  }
  const sig = req.headers.get("paddle-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, sig)) {
    await auditLog({ action: "paddle.webhook.signature_invalid" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: PaddleWebhookPayload;
  try {
    payload = JSON.parse(raw) as PaddleWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = payload.event_id;
  const eventType = payload.event_type;
  if (!eventId || !eventType) {
    return NextResponse.json({ error: "Missing event id or type" }, { status: 400 });
  }

  // Acquire the claim with a fresh processingToken (atomic, race-safe).
  let token = await claim(eventId, eventType);
  if (token === null) {
    token = await reclaimStale(eventId);
    if (token === null) {
      return ok({ received: true, outcome: "skipped-other-worker" });
    }
  }

  let sideEffectsError: unknown = null;
  try {
    await applyEvent(payload, eventId);
  } catch (e) {
    sideEffectsError = e;
  }

  if (sideEffectsError === null) {
    const finalized = await markProcessed(eventId, token);
    if (!finalized) {
      return ok({ received: true, outcome: "skipped-other-worker" });
    }
    return ok({ received: true, outcome: "applied" });
  } else {
    const finalized = await markFailed(eventId, token, String(sideEffectsError instanceof Error ? sideEffectsError.message : sideEffectsError));
    if (!finalized) {
      return ok({ received: true, outcome: "skipped-other-worker" });
    }
    await auditLog({ action: "paddle.webhook.failed", metadata: { eventId, type: eventType } });
    return NextResponse.json({ error: "Webhook processing failed; retrying." }, { status: 500 });
  }
});

/* ------------------------------------------------------------------ */
/*                       Business side effects                          */
/* ------------------------------------------------------------------ */

async function applyEvent(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  switch (payload.event_type) {
    case "subscription.created":
    case "subscription.updated":
      await onSubscriptionUpsert(payload, eventId);
      break;
    case "subscription.canceled":
    case "subscription.expired":
      await onSubscriptionEnded(payload, eventId);
      break;
    case "subscription.past_due":
    case "subscription.payment_failed":
    case "transaction.payment_failed":
      await onPaymentFailed(payload, eventId);
      break;
    case "transaction.completed":
      await onTransactionCompleted(payload, eventId);
      break;
    case "transaction.refunded":
      await onTransactionRefunded(payload, eventId);
      break;
    default:
      // Unknown event types are ignored — not an error.
      return;
  }
}

/**
 * Resolve the user that owns the resource.
 *
 * Resolution order (first match wins):
 *   1. `custom_data.userId` — set by `PaddleButton` when the checkout is
 *      opened. This is the ONLY mechanism that can identify a brand-new
 *      Paddle customer: `User.paddleCustomerId` is written by this very
 *      handler, so on the first webhook it is still NULL and a
 *      customer_id-only lookup fails and silently swallows the payment.
 *   2. `customer_id` → `User.paddleCustomerId` (persisted on first contact).
 *   3. `subscription_id` → `Subscription.paddleSubscriptionId`.
 *
 * `custom_data.userId` is trusted only because the webhook signature was
 * already verified against `PADDLE_WEBHOOK_SECRET` above — Paddle echoes
 * back exactly what our own client sent.
 */
async function findUser(payload: PaddleWebhookPayload): Promise<{ id: string; email: string; name: string | null; paddleCustomerId: string | null } | null> {
  const customUserId = payload.data?.custom_data?.userId;
  if (customUserId) {
    const u = await db.user.findUnique({ where: { id: customUserId } });
    // Never grant entitlement to a soft-deleted account.
    if (u && !u.deletedAt) return { id: u.id, email: u.email, name: u.name, paddleCustomerId: u.paddleCustomerId };
  }
  if (payload.data?.customer_id) {
    const u = await db.user.findUnique({ where: { paddleCustomerId: payload.data.customer_id } });
    if (u && !u.deletedAt) return { id: u.id, email: u.email, name: u.name, paddleCustomerId: u.paddleCustomerId };
  }
  // Subscription ids are stored on Subscription rows; we walk them.
  if (payload.data?.subscription_id) {
    const sub = await db.subscription.findUnique({
      where: { paddleSubscriptionId: payload.data.subscription_id },
      include: { user: true },
    });
    if (sub?.user && !sub.user.deletedAt) return { id: sub.user.id, email: sub.user.email, name: sub.user.name, paddleCustomerId: sub.user.paddleCustomerId };
  }
  return null;
}

/**
 * Map a Paddle price id to an internal Plan key.
 *
 * `planKeyForPriceId` returns null for a price id that is not one of ours.
 * We then fall back to "pro": the customer demonstrably paid us in this
 * Paddle account and locking them out would be worse than granting the
 * entry tier. The unmapped price id is recorded in the audit log so the
 * misconfiguration is visible rather than silent.
 */
function priceIdToPlanKey(priceId: string | undefined): PaddlePlanKey {
  const mapped = planKeyForPriceId(priceId);
  if (mapped) return mapped;
  return "pro";
}


/**
 * Out-of-order protection. Paddle does not guarantee delivery order, so an
 * older `subscription.updated` arriving after a newer `subscription.canceled`
 * must NOT resurrect the subscription. We compare the event's `occurred_at`
 * with the last event we applied to the same subscription.
 */
function eventTime(payload: PaddleWebhookPayload): Date {
  const t = payload.occurred_at ? new Date(payload.occurred_at) : new Date();
  return Number.isNaN(t.getTime()) ? new Date() : t;
}

async function isStaleForSubscription(paddleSubId: string, at: Date): Promise<boolean> {
  const existing = await db.subscription.findUnique({
    where: { paddleSubscriptionId: paddleSubId },
    select: { lastEventAt: true },
  });
  return Boolean(existing?.lastEventAt && existing.lastEventAt > at);
}

async function onSubscriptionUpsert(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) {
    // Unresolvable: the purchase happened but we cannot attribute it to an
    // account. Throw so Paddle retries and we return 500, rather than
    // acknowledging a payment we silently discarded.
    await auditLog({
      action: "paddle.webhook.unresolved_customer",
      metadata: {
        eventId,
        customerId: payload.data?.customer_id ?? null,
        subscriptionId: payload.data?.subscription_id ?? null,
        customData: payload.data?.custom_data ?? null,
      },
    });
    throw new Error("Paddle webhook: could not resolve the AutoEco user for this purchase");
  }

  const data = payload.data ?? {};
  const paddleSubId = data.subscription_id;
  const paddleCustomerId = data.customer_id;
  const status = (data.status ?? "active").toLowerCase();
  if (!paddleSubId) return;
  const at = eventTime(payload);
  if (await isStaleForSubscription(paddleSubId, at)) {
    await auditLog({ action: "paddle.webhook.stale_event_ignored", metadata: { eventId, type: payload.event_type, paddleSubId } });
    return;
  }

  // Determine the plan from the price id of the first item (if any).
  const priceId = data.items?.[0]?.price?.id;
  if (priceId && !planKeyForPriceId(priceId)) {
    await auditLog({ action: "paddle.webhook.unmapped_price_id", metadata: { eventId, priceId } });
  }
  const planKey = priceIdToPlanKey(priceId);
  const plan = await db.plan.findUnique({ where: { key: planKey } });
  if (!plan) {
    await auditLog({ action: "paddle.webhook.plan_missing", metadata: { eventId, planKey } });
    throw new Error(`Paddle webhook: plan "${planKey}" is not seeded`);
  }

  const isLifetime = plan.billingPeriod === "LIFETIME";

  // Respect Paddle's real billing schedule instead of assuming 30 days,
  // and never wipe a customer-scheduled cancellation.
  const startsAt = data.current_billing_period?.starts_at ? new Date(data.current_billing_period.starts_at) : null;
  const periodStart = startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : at;
  const nextBilled = data.next_billed_at ? new Date(data.next_billed_at) : null;
  const hasRealNextBill = nextBilled != null && !Number.isNaN(nextBilled.getTime());
  const periodEnd = isLifetime
    ? null
    : hasRealNextBill
      ? nextBilled
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const cancelAtPeriodEnd = data.scheduled_change != null;

  await db.user.update({
    where: { id: user.id },
    data: {
      planId: plan.id,
      // A real purchase retires the trial, so a later cancellation cannot
      // hand the trial entitlements back (same rule as every other billing provider).
      trialEndsAt: null,
      trialUsed: true,
      // Persist the Paddle customer id once we know it (do not overwrite).
      ...(paddleCustomerId && !user.paddleCustomerId
        ? { paddleCustomerId: paddleCustomerId }
        : {}),
    },
  });

  await db.subscription.upsert({
    where: { paddleSubscriptionId: paddleSubId },
    create: {
      userId: user.id,
      planId: plan.id,
      status: isLifetime ? "lifetime" : status,
      paddleSubscriptionId: paddleSubId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      lastEventAt: at,
    },
    update: {
      planId: plan.id,
      status: isLifetime ? "lifetime" : status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      lastEventAt: at,
    },
  });

  if (await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "PAYMENT_SUCCESS", title: "Payment successful", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_EMAIL")) {
    await sendEmail({ ...tplPaymentSuccess(user.name, plan.name), to: user.email });
  }
  // The single most important business metric: a paying customer.
  if (await tryClaimSideEffect(eventId, "PADDLE_SUBSCRIPTION_CREATED_ANALYTICS")) {
    await trackEvent("subscription_created", {
      userId: user.id,
      metadata: { planKey, provider: "paddle", status },
    });
  }
}

async function onSubscriptionEnded(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;
  const paddleSubId = payload.data?.subscription_id;
  if (!paddleSubId) return;
  const at = eventTime(payload);
  if (await isStaleForSubscription(paddleSubId, at)) return;
  await db.subscription.updateMany({
    where: { paddleSubscriptionId: paddleSubId },
    data: { status: "canceled", canceledAt: at, lastEventAt: at },
  });
  const stillActive = await db.subscription.count({ where: { userId: user.id, status: { in: ["active", "trialing", "lifetime"] } } });
  if (stillActive === 0) {
    const free = await db.plan.findFirst({ where: { key: "free" } });
    if (free) await db.user.update({ where: { id: user.id }, data: { planId: free.id } });
  }

  if (await tryClaimSideEffect(eventId, "PADDLE_SUBSCRIPTION_CANCELED_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "SUBSCRIPTION_CANCELED", title: "Your subscription was canceled", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "PADDLE_SUBSCRIPTION_CANCELED_EMAIL")) {
    const sub = await db.subscription.findFirst({ where: { paddleSubscriptionId: paddleSubId } });
    const endDate = sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : "soon";
    await sendEmail({ ...tplSubscriptionCanceled(user.name, endDate), to: user.email });
  }
}

/**
 * A renewal payment failed.
 *
 * Paddle keeps retrying the charge, so the subscription enters `past_due`
 * rather than ending immediately. `getEntitlements()` grants a bounded
 * `PAST_DUE_GRACE_DAYS` grace period and then falls back to free, so the
 * customer must be told — otherwise they silently lose paid features the
 * moment the grace period lapses, with no idea why.
 *
 * `planId` on the user is deliberately NOT downgraded here: Paddle may still
 * recover the payment, and entitlements are computed from the Subscription
 * row's status, not from `planId`.
 */
async function onPaymentFailed(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;
  const paddleSubId = payload.data?.subscription_id;
  const eventType = payload.event_type ?? "unknown";

  if (paddleSubId) {
    const at = eventTime(payload);
    if (await isStaleForSubscription(paddleSubId, at)) return;
    // Never downgrade a lifetime purchase to past_due, and never flip an
    // already-canceled subscription back to past_due.
    await db.subscription.updateMany({
      where: { paddleSubscriptionId: paddleSubId, status: { notIn: ["lifetime", "canceled"] } },
      data: { status: "past_due", lastEventAt: at },
    });
  }

  await auditLog({
    action: "paddle.payment_failed",
    metadata: { eventId, eventType, subscriptionId: paddleSubId ?? null, userId: user.id },
  });

  if (await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_FAILED_NOTIFICATION")) {
    await createNotification({
      userId: user.id,
      type: "PAYMENT_FAILED",
      title: "Payment failed — action required",
      body: "We could not process your last payment. Update your billing details to keep your paid features.",
      link: "/settings/billing",
    });
  }
  if (await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_FAILED_EMAIL")) {
    await sendEmail({ ...tplPaymentFailed(user.name, env.appUrl), to: user.email });
  }
}

async function onTransactionCompleted(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const data = payload.data ?? {};
  const user = await findUser(payload);
  if (!user) return;
  const orderId = data.id;
  if (!orderId) return;
  // Paddle Billing reports every amount as a STRING in the lowest
  // denomination of the currency (e.g. "699" = $6.99). It is already "cents":
  // multiplying by 100 again made invoices 100x too large.
  const amountCents = paddleAmountToCents(data.details?.totals?.grand_total);
  // Keep the real ISO 4217 code Paddle charged. Coercing unknown codes to USD
  // recorded revenue in the wrong currency for every non-USD market.
  const invoiceCurrency = normalizeInvoiceCurrency(data.currency_code ?? data.details?.totals?.currency_code);

  await db.invoice.upsert({
    where: { paddleOrderId: orderId },
    create: {
      userId: user.id,
      paddleOrderId: orderId,
      stripeInvoiceId: `paddle_invoice_${orderId}`,
      amountCents,
      currency: invoiceCurrency,
      status: "paid",
    },
    update: {
      amountCents,
      currency: invoiceCurrency,
      status: "paid",
    },
  });
}

async function onTransactionRefunded(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;
  const orderId = payload.data?.id;
  if (!orderId) return;
  const inv = await db.invoice.findUnique({ where: { paddleOrderId: orderId } });
  if (!inv) return;
  await db.invoice.update({ where: { id: inv.id }, data: { status: "refunded" } });
}
