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
import { paddleWebhookConfigured } from "@/lib/env";
import { appOrigin } from "@/lib/seo";
import {
  verifyWebhookSignature,
  planKeyForPriceId,
  paddleAmountToCents,
  normalizeInvoiceCurrency,
  type PaddleWebhookPayload,
} from "@/lib/paddle";
import { db } from "@/lib/db";
import { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "@/lib/webhook-state";
import { cancelPaddleSubscription } from "@/lib/paddle-api";
import { createNotification } from "@/lib/notifications";
import { sendEmail, tplPaymentSuccess, tplPaymentFailed, tplSubscriptionCanceled } from "@/lib/email";
import { coerceLocale } from "@/lib/i18n";
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
    // Authoritative lifecycle transitions. Deliberately NOT routed through
    // `onSubscriptionUpsert`, which would also fire purchase side effects
    // (payment-success email/notification + `subscription_created` analytic)
    // that must only fire for a real payment. See `onSubscriptionLifecycle`.
    case "subscription.activated":
    case "subscription.paused":
    case "subscription.resumed":
      await onSubscriptionLifecycle(payload, eventId);
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
    // Paddle Billing reports refunds (and credits/chargebacks) as adjustments,
    // NOT as `transaction.refunded`. Only approved refunds are actionable;
    // see `onAdjustment` for the entitlement rule.
    case "adjustment.created":
    case "adjustment.updated":
      await onAdjustment(payload, eventId);
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
async function findUser(payload: PaddleWebhookPayload): Promise<{ id: string; email: string; name: string | null; locale: string | null; paddleCustomerId: string | null } | null> {
  const customUserId = payload.data?.custom_data?.userId;
  if (customUserId) {
    const u = await db.user.findUnique({ where: { id: customUserId } });
    // Never grant entitlement to a soft-deleted account.
    if (u && !u.deletedAt) return { id: u.id, email: u.email, name: u.name, locale: u.locale, paddleCustomerId: u.paddleCustomerId };
  }
  if (payload.data?.customer_id) {
    const u = await db.user.findUnique({ where: { paddleCustomerId: payload.data.customer_id } });
    if (u && !u.deletedAt) return { id: u.id, email: u.email, name: u.name, locale: u.locale, paddleCustomerId: u.paddleCustomerId };
  }
  // Subscription ids are stored on Subscription rows; we walk them.
  if (payload.data?.subscription_id) {
    const sub = await db.subscription.findUnique({
      where: { paddleSubscriptionId: payload.data.subscription_id },
      include: { user: true },
    });
    if (sub?.user && !sub.user.deletedAt) return { id: sub.user.id, email: sub.user.email, name: sub.user.name, locale: sub.user.locale, paddleCustomerId: sub.user.paddleCustomerId };
  }
  return null;
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

  // The plan is determined SOLELY by the price id of the first item. A price
  // id we cannot map to one of our plans (including a former lifetime price id)
  // must NOT grant any entitlement, and must not throw — otherwise Paddle would
  // retry it forever. It is logged for the owner to reconcile by hand instead.
  const priceId = data.items?.[0]?.price?.id;
  const planKey = planKeyForPriceId(priceId);
  if (!planKey) {
    await auditLog({
      action: "paddle.webhook.unmapped_price_id",
      metadata: { eventId, priceId: priceId ?? null, transactionId: data.transaction_id ?? null, subscriptionId: paddleSubId },
    });
    return;
  }
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
    await sendEmail({ ...tplPaymentSuccess(user.name, plan.name, coerceLocale(user.locale)), to: user.email });
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
  await downgradeToFreeIfInactive(user.id);

  if (await tryClaimSideEffect(eventId, "PADDLE_SUBSCRIPTION_CANCELED_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "SUBSCRIPTION_CANCELED", title: "Your subscription was canceled", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "PADDLE_SUBSCRIPTION_CANCELED_EMAIL")) {
    const sub = await db.subscription.findFirst({ where: { paddleSubscriptionId: paddleSubId } });
    const endDate = sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : "soon";
    await sendEmail({ ...tplSubscriptionCanceled(user.name, endDate, coerceLocale(user.locale)), to: user.email });
  }
}

/**
 * Drop the user to the free plan when none of their subscriptions is active.
 * Shared by `onSubscriptionEnded` and `onSubscriptionLifecycle` so a pause and
 * a cancellation degrade entitlements identically.
 */
async function downgradeToFreeIfInactive(userId: string): Promise<void> {
  const stillActive = await db.subscription.count({ where: { userId, status: { in: ["active", "trialing", "lifetime"] } } });
  if (stillActive > 0) return;
  const free = await db.plan.findFirst({ where: { key: "free" } });
  if (free) await db.user.update({ where: { id: userId }, data: { planId: free.id } });
}

/**
 * Handle the authoritative lifecycle transitions:
 *   - `subscription.activated` → the trial ended and Paddle billed, or a
 *     paused subscription was reactivated. Status becomes `active`.
 *   - `subscription.paused` → status becomes `paused` (access must end).
 *   - `subscription.resumed` → status becomes `active` (Paddle bills again).
 *
 * Why these are handled here and not ignored: Paddle does NOT guarantee a
 * companion `subscription.updated`. It "typically follows" activation and is
 * only emitted when a pause/resume is *scheduled* — at the moment an immediate
 * pause takes effect only `subscription.paused` is delivered. Ignoring these
 * events would leave a paused customer holding paid access, or a resumed one
 * locked out, until some unrelated update arrived.
 *
 * Why they bypass `onSubscriptionUpsert`: that path emits purchase side
 * effects (payment-success email/notification, `subscription_created`
 * analytic). A pause/resume is not a purchase, so those must not fire.
 *
 * Reuses the same out-of-order guard as the other handlers, and never mutates
 * a `lifetime` purchase nor resurrects a `canceled` subscription.
 */
async function onSubscriptionLifecycle(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) {
    await auditLog({
      action: "paddle.webhook.unresolved_customer",
      metadata: { eventId, type: payload.event_type, subscriptionId: payload.data?.subscription_id ?? null },
    });
    return;
  }

  const paddleSubId = payload.data?.subscription_id;
  if (!paddleSubId) return;
  const status = (payload.data?.status ?? "").toLowerCase();
  // Only the three statuses these events can carry are meaningful here.
  if (status !== "active" && status !== "trialing" && status !== "paused") return;

  const at = eventTime(payload);
  if (await isStaleForSubscription(paddleSubId, at)) {
    await auditLog({ action: "paddle.webhook.stale_event_ignored", metadata: { eventId, type: payload.event_type, paddleSubId } });
    return;
  }

  const existing = await db.subscription.findUnique({ where: { paddleSubscriptionId: paddleSubId } });
  if (!existing) {
    await auditLog({ action: "paddle.webhook.lifecycle_unknown_subscription", metadata: { eventId, type: payload.event_type, paddleSubId } });
    return;
  }
  // A lifetime purchase is terminal; a canceled subscription must not be
  // brought back by a late activation/resume event.
  if (existing.status === "lifetime" || existing.status === "canceled") {
    await auditLog({ action: "paddle.webhook.lifecycle_ignored_terminal", metadata: { eventId, type: payload.event_type, paddleSubId, status: existing.status } });
    return;
  }

  const data = payload.data ?? {};
  const periodStart = parsePaddleDate(data.current_billing_period?.starts_at) ?? existing.currentPeriodStart;
  // A paused subscription has no current billing period; an active/trialing one
  // takes the window Paddle sends (falling back to the existing values).
  const periodEnd =
    status === "paused"
      ? null
      : parsePaddleDate(data.current_billing_period?.ends_at) ?? parsePaddleDate(data.next_billed_at) ?? existing.currentPeriodEnd;

  await db.subscription.update({
    where: { id: existing.id },
    data: {
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: data.scheduled_change != null,
      // Resuming/activating clears a previous cancellation; pausing leaves it.
      canceledAt: status === "paused" ? existing.canceledAt : null,
      lastEventAt: at,
    },
  });

  if (status === "paused") {
    // Access ends when the last active subscription pauses.
    await downgradeToFreeIfInactive(user.id);
  } else {
    // Reactivation restores the paid pointer (the Subscription row already
    // knows the plan), so the UI reflects the plan that was just resumed.
    const plan = await db.plan.findUnique({ where: { id: existing.planId } });
    if (plan) await db.user.update({ where: { id: user.id }, data: { planId: plan.id } });
  }

  await auditLog({
    userId: user.id,
    action: "paddle.subscription.lifecycle",
    metadata: { eventId, type: payload.event_type, paddleSubId, status },
  });
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
    await sendEmail({ ...tplPaymentFailed(user.name, appOrigin(), coerceLocale(user.locale)), to: user.email });
  }
}

async function onTransactionCompleted(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const data = payload.data ?? {};
  const user = await findUser(payload);
  if (!user) return;
  const orderId = data.id;
  if (!orderId) return;
  // A transaction whose price id does not map to any of our plans (including a
  // former lifetime price id) must not be ignored: log it for the owner to
  // reconcile. It never grants entitlement and never fails the webhook.
  const txPriceId = data.items?.[0]?.price?.id;
  if (!planKeyForPriceId(txPriceId)) {
    await auditLog({
      action: "paddle.webhook.unmapped_price_id",
      metadata: { eventId, priceId: txPriceId ?? null, transactionId: orderId },
    });
  }
  // Paddle Billing reports every amount as a STRING in the lowest
  // denomination of the currency (e.g. "699" = $6.99). It is already "cents":
  // multiplying by 100 again made invoices 100x too large.
  const amountCents = paddleAmountToCents(data.details?.totals?.grand_total);
  // Keep the real ISO 4217 code Paddle charged. Coercing unknown codes to USD
  // recorded revenue in the wrong currency for every non-USD market.
  const invoiceCurrency = normalizeInvoiceCurrency(data.currency_code ?? data.details?.totals?.currency_code);
  // Link the payment to its subscription and record Paddle's own timestamp so
  // a later refund can tell whether it covers the latest payment of that
  // subscription. Both are optional (one-off purchases have no subscription).
  const paddleSubId = data.subscription_id ?? null;
  const billedAt = parsePaddleDate(data.billed_at ?? data.created_at);

  await db.invoice.upsert({
    where: { paddleOrderId: orderId },
    create: {
      userId: user.id,
      paddleOrderId: orderId,
      stripeInvoiceId: `paddle_invoice_${orderId}`,
      amountCents,
      currency: invoiceCurrency,
      status: "paid",
      paddleSubscriptionId: paddleSubId,
      paddleBilledAt: billedAt,
    },
    update: {
      amountCents,
      currency: invoiceCurrency,
      status: "paid",
      ...(paddleSubId ? { paddleSubscriptionId: paddleSubId } : {}),
      ...(billedAt ? { paddleBilledAt: billedAt } : {}),
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

/** Parse a Paddle RFC 3339 timestamp; returns null when absent/invalid. */
function parsePaddleDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Refunds and other adjustments arrive as `adjustment.created` /
 * `adjustment.updated` (Paddle Billing), NOT `transaction.refunded`.
 *
 * Entitlement rule (agreed with the owner):
 *   - Only `action: "refund"` with `status: "approved"` is actionable.
 *     Credits, chargebacks, reversals and non-approved refunds are ignored.
 *   - A FULL refund revokes access ONLY when it covers the latest paid
 *     transaction of that subscription and no later successful payment
 *     exists. We then cancel the Paddle subscription immediately and let the
 *     (out-of-order-guarded) `subscription.canceled` event downgrade local
 *     entitlements.
 *   - Partial refunds, and refunds of older transactions, only record the
 *     refunded amount and keep access.
 *   - Unknown transactions are ignored (not an error).
 *   - Replays and the created→updated pair are idempotent via
 *     `RefundAdjustment.adjustmentId`.
 *   - A failed Paddle cancel never fails the webhook; it is flagged for the
 *     owner to action by hand.
 */
async function onAdjustment(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const data = payload.data ?? {};
  if (data.action !== "refund") return; // credits/chargebacks/reversals are out of scope
  if (data.status !== "approved") return; // pending_approval | rejected | reversed

  const adjustmentId = data.id;
  const transactionId = data.transaction_id;
  if (!adjustmentId || !transactionId) return;

  const type = data.type === "full" ? "full" : "partial";
  const refundCents = paddleAmountToCents(data.totals?.total);
  const currency = normalizeInvoiceCurrency(data.currency_code ?? data.totals?.currency_code);

  const invoice = await db.invoice.findUnique({ where: { paddleOrderId: transactionId } });
  if (!invoice) {
    // Not one of ours (or a transaction we never recorded). Not an error.
    await auditLog({
      action: "paddle.refund.unknown_transaction",
      metadata: { eventId, adjustmentId, transactionId },
    });
    return;
  }

  // Idempotency: claim the adjustment once. The UNIQUE index collapses the
  // created→updated pair and retries into a single application, and the claim
  // is committed together with the invoice update so a failed transaction is
  // rolled back and retried as a whole.
  let refundedTotal: number;
  try {
    refundedTotal = await db.$transaction(async (tx) => {
      await tx.refundAdjustment.create({
        data: { adjustmentId, transactionId, amountCents: refundCents, currency, type },
      });
      const agg = await tx.refundAdjustment.aggregate({
        where: { transactionId },
        _sum: { amountCents: true },
      });
      const total = agg._sum.amountCents ?? 0;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          refundedAmountCents: total,
          status: invoice.amountCents > 0 && total >= invoice.amountCents ? "refunded" : "partially_refunded",
        },
      });
      return total;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return; // already applied: replay / created→updated pair
    throw e;
  }

  await auditLog({
    userId: invoice.userId,
    action: "paddle.refund.recorded",
    metadata: { eventId, adjustmentId, transactionId, type, refundedTotal, currency },
  });

  // Only a FULL refund of the latest successful payment of a subscription
  // revokes access. Everything else keeps it.
  if (type !== "full") return;

  const subId = invoice.paddleSubscriptionId;
  if (!subId) {
    // One-off / lifetime purchase: there is no subscription to cancel. Flag it
    // rather than silently keeping access.
    await auditLog({
      userId: invoice.userId,
      action: "paddle.refund.no_subscription",
      metadata: { eventId, adjustmentId, transactionId },
    });
    return;
  }

  const at = eventTime(payload);
  if (await isStaleForSubscription(subId, at)) {
    await auditLog({
      userId: invoice.userId,
      action: "paddle.refund.stale_ignored",
      metadata: { eventId, adjustmentId, subscriptionId: subId },
    });
    return;
  }

  // "Latest paid transaction of that subscription": no later successful
  // payment may exist. The refunded invoice is included in the candidate set.
  const latest = await db.invoice.findFirst({
    where: {
      paddleSubscriptionId: subId,
      status: { in: ["paid", "refunded", "partially_refunded"] },
    },
    orderBy: [{ paddleBilledAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!latest || latest.id !== invoice.id) {
    // A later successful payment exists — the customer is still entitled.
    await auditLog({
      userId: invoice.userId,
      action: "paddle.refund.older_transaction",
      metadata: { eventId, adjustmentId, subscriptionId: subId },
    });
    return;
  }

  try {
    await cancelPaddleSubscription(subId, false);
    await auditLog({
      userId: invoice.userId,
      action: "paddle.refund.subscription_canceled",
      metadata: { eventId, adjustmentId, subscriptionId: subId },
    });
  } catch (e) {
    // Do NOT fail the webhook: the invoice state is already consistent and
    // throwing would make Paddle retry a refund we have already recorded.
    // Flag it so the owner can cancel by hand.
    await auditLog({
      userId: invoice.userId,
      action: "paddle.refund.cancel_failed",
      metadata: {
        eventId,
        adjustmentId,
        subscriptionId: subId,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}
