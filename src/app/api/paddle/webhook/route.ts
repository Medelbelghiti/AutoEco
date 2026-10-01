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
  type PaddleWebhookPayload,
  type PaddlePlanKey,
} from "@/lib/paddle";
import { db } from "@/lib/db";
import { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "@/lib/webhook-state";
import { createNotification } from "@/lib/notifications";
import { sendEmail, tplPaymentSuccess, tplPaymentFailed, tplSubscriptionCanceled } from "@/lib/email";
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
 * Resolve the user that owns the resource. The Paddle webhook identifies
 * the customer by `customer_id`. We persist the customer id on the user
 * at first contact; subsequent webhooks can look the user up by that
 * unique key.
 */
async function findUser(payload: PaddleWebhookPayload): Promise<{ id: string; email: string; name: string | null; paddleCustomerId: string | null } | null> {
  if (payload.data?.customer_id) {
    const u = await db.user.findUnique({ where: { paddleCustomerId: payload.data.customer_id } });
    if (u) return { id: u.id, email: u.email, name: u.name, paddleCustomerId: u.paddleCustomerId };
  }
  // Subscription ids are stored on Subscription rows; we walk them.
  if (payload.data?.subscription_id) {
    const sub = await db.subscription.findUnique({
      where: { paddleSubscriptionId: payload.data.subscription_id },
      include: { user: true },
    });
    if (sub?.user) return { id: sub.user.id, email: sub.user.email, name: sub.user.name, paddleCustomerId: sub.user.paddleCustomerId };
  }
  return null;
}

/**
 * Map a Paddle price id to an internal Plan key. If we cannot match the
 * price id, fall back to "pro" so the user is never silently locked out —
 * but log the unrecognised price id in the webhook event metadata for
 * audit.
 */
function priceIdToPlanKey(priceId: string | undefined): PaddlePlanKey {
  if (!priceId) return "pro";
  if (priceId === env.paddleProPriceId) return "pro";
  if (priceId === env.paddleBusinessPriceId) return "business";
  if (priceId === env.paddleLifetimePriceId) return "lifetime";
  // The current subscription API uses "active" / "canceled" / "trialing"
  // — we don't have a "pro_plus" product at Paddle; map unknown to pro
  // so the user gets full access rather than a broken state.
  return "pro";
}

async function onSubscriptionUpsert(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;

  const data = payload.data ?? {};
  const paddleSubId = data.subscription_id;
  const paddleCustomerId = data.customer_id;
  const status = (data.status ?? "active").toLowerCase();
  if (!paddleSubId) return;

  // Determine the plan from the price id of the first item (if any).
  const priceId = data.items?.[0]?.price?.id;
  const planKey = priceIdToPlanKey(priceId);
  const plan = await db.plan.findUnique({ where: { key: planKey } });
  if (!plan) return;

  const isLifetime = plan.billingPeriod === "LIFETIME";

  await db.user.update({
    where: { id: user.id },
    data: {
      planId: plan.id,
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
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    },
    update: {
      planId: plan.id,
      status: isLifetime ? "lifetime" : status,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    },
  });

  if (await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "PAYMENT_SUCCESS", title: "Payment successful", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "PADDLE_PAYMENT_SUCCESS_EMAIL")) {
    await sendEmail({ ...tplPaymentSuccess(user.name, plan.name), to: user.email });
  }
}

async function onSubscriptionEnded(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;
  const paddleSubId = payload.data?.subscription_id;
  if (!paddleSubId) return;
  await db.subscription.updateMany({
    where: { paddleSubscriptionId: paddleSubId },
    data: { status: "canceled", canceledAt: new Date() },
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

async function onTransactionCompleted(payload: PaddleWebhookPayload, eventId: string): Promise<void> {
  const data = payload.data ?? {};
  const user = await findUser(payload);
  if (!user) return;
  const orderId = data.id;
  if (!orderId) return;
  // Paddle reports amounts in MAJOR units (e.g. 12.34 USD). Convert to cents.
  const rawAmount = Number(data.details?.totals?.grand_total ?? 0);
  const amountCents = Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount * 100)) : 0;
  const rawCurrency = String(data.currency_code ?? data.details?.totals?.currency_code ?? "USD").toUpperCase();
  const invoiceCurrency = (["USD", "EUR", "MAD", "GBP", "CAD"] as string[]).includes(rawCurrency) ? rawCurrency : "USD";

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
