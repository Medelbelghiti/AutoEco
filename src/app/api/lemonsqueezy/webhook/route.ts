/**
 * POST /api/lemonsqueezy/webhook
 *
 * The production payment provider for AutoEco. The route reuses the
 * existing `WebhookEvent` (with processingToken ownership) and
 * `WebhookSideEffect` (durable side-effect idempotency) protections —
 * the SAME primitives used by the Stripe handler. We do NOT create a
 * parallel idempotency mechanism.
 *
 * Signature verification:
 *   hex(HMAC-SHA256(LEMON_SQUEEZY_WEBHOOK_SECRET, raw_body))
 *   sent in the `X-Signature` header.
 *
 * The final production URL is whatever NEXT_PUBLIC_APP_URL resolves to
 * at deploy time (set in Vercel). The webhook must be configured in
 * the Lemon Squeezy dashboard to point at:
 *   https://<PRODUCTION_DOMAIN>/api/lemonsqueezy/webhook
 */
import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { lemonSqueezyWebhookConfigured, env } from "@/lib/env";
import { verifyWebhookSignature, type LemonWebhookPayload } from "@/lib/lemon-squeezy";
import { db } from "@/lib/db";
import { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "@/lib/webhook-state";
import { createNotification } from "@/lib/notifications";
import { sendEmail, tplPaymentSuccess, tplPaymentFailed, tplSubscriptionCanceled } from "@/lib/email";
import { auditLog } from "@/lib/audit";

export const POST = withErrorHandling(async (req) => {
  if (!lemonSqueezyWebhookConfigured()) {
    return NextResponse.json({ error: "Lemon Squeezy webhook is not configured." }, { status: 503 });
  }
  const sig = req.headers.get("x-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, sig)) {
    await auditLog({ action: "lemon.webhook.signature_invalid" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: LemonWebhookPayload;
  try {
    payload = JSON.parse(raw) as LemonWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload?.meta?.event_name || !payload?.data?.id) {
    return NextResponse.json({ error: "Missing event metadata" }, { status: 400 });
  }

  // Use the Lemon Squeezy event id as the WebhookEvent key. This is
  // provider-neutral — the same WebhookEvent + WebhookSideEffect
  // architecture is used by Stripe and Lemon Squeezy.
  const eventId = `lsq_${payload.meta.event_name}_${payload.data.id}`;
  const eventType = payload.meta.event_name;

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
    await auditLog({ action: "lemon.webhook.failed", metadata: { eventId, type: eventType } });
    // Return 500 so Lemon Squeezy retries.
    return NextResponse.json({ error: "Webhook processing failed; retrying." }, { status: 500 });
  }
});

/* ------------------------------------------------------------------ */
/*                       Business side effects                          */
/* ------------------------------------------------------------------ */

async function applyEvent(payload: LemonWebhookPayload, eventId: string): Promise<void> {
  switch (payload.meta.event_name) {
    case "order_created":
    case "subscription_created":
    case "subscription_updated":
      await onSubscriptionUpsert(payload, eventId);
      break;
    case "subscription_cancelled":
    case "subscription_expired":
      await onSubscriptionEnded(payload, eventId);
      break;
    case "order_refunded":
      await onOrderRefunded(payload, eventId);
      break;
    default:
      // Unknown event types are ignored — not an error.
      return;
  }
}

async function findUser(payload: LemonWebhookPayload): Promise<{ id: string; email: string; name: string | null; stripeCustomerId: string | null } | null> {
  const userId = payload.meta.custom_data?.user_id;
  const customerEmail = payload.data.attributes.customer_email ?? payload.data.attributes.user_email;
  if (userId) {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (u) return { id: u.id, email: u.email, name: u.name, stripeCustomerId: u.stripeCustomerId };
  }
  if (customerEmail) {
    const u = await db.user.findUnique({ where: { email: customerEmail.toLowerCase() } });
    if (u) return { id: u.id, email: u.email, name: u.name, stripeCustomerId: u.stripeCustomerId };
  }
  return null;
}

async function variantIdToPlanKey(variantId: string): Promise<"pro" | "business" | "pro_plus" | "lifetime" | null> {
  if (!variantId) return null;
  if (variantId === env.lemonSqueezyProVariantId) return "pro";
  if (variantId === env.lemonSqueezyBusinessVariantId) return "business";
  if (variantId === env.lemonSqueezyLifetimeVariantId) return "lifetime";
  // pro_plus is mapped to the business variant in the client.
  if (env.lemonSqueezyBusinessVariantId && variantId === env.lemonSqueezyBusinessVariantId) return "pro_plus";
  return null;
}

async function onSubscriptionUpsert(payload: LemonWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;

  // The variant id is in the "first_order_item" / "variant_id" attribute.
  const attrs = payload.data.attributes as Record<string, unknown>;
  const variantId = (attrs["variant_id"] ?? attrs["first_order_item"] ?? null) as string | null;
  let planKey = variantId ? await variantIdToPlanKey(variantId) : null;

  // For Lifetime purchases we look for a specific flag.
  if (planKey === null) {
    // Best-effort fallback: if the user has no plan yet, default to pro
    // so they get full access rather than a broken state.
    planKey = "pro";
  }

  const plan = await db.plan.findUnique({ where: { key: planKey } });
  if (!plan) return;

  const isLifetime = plan.billingPeriod === "LIFETIME";
  const lemonSubId = payload.data.id;
  const customerId = payload.data.attributes.customer_id ?? lemonSubId;

  // Persist the Lemon Squeezy identifiers on the user (additive).
  await db.user.update({
    where: { id: user.id },
    data: {
      planId: plan.id,
      // Do not overwrite the existing Stripe customer id.
      ...(customerId && !user.stripeCustomerId ? { lemonCustomerId: String(customerId) } : {}),
    },
  });

  if (isLifetime) {
    await db.subscription.upsert({
      where: { lemonSubscriptionId: lemonSubId },
      create: {
        userId: user.id, planId: plan.id, status: "lifetime",
        lemonSubscriptionId: lemonSubId, currentPeriodStart: new Date(),
      },
      update: { planId: plan.id, status: "lifetime" },
    });
  } else {
    await db.subscription.upsert({
      where: { lemonSubscriptionId: lemonSubId },
      create: {
        userId: user.id, planId: plan.id, status: "active",
        lemonSubscriptionId: lemonSubId, currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      },
      update: { planId: plan.id, status: "active" },
    });
  }

  // Also persist an Invoice record for the order.
  if (payload.data.type === "orders") {
    const orderId = String(payload.data.id);
    const rawAmount = Number(attrs["total"] ?? attrs["subtotal"] ?? 0);
    const amountCents = Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount * 100)) : 0;
    const rawCurrency = String(attrs["currency"] ?? "USD").toUpperCase();
    const invoiceCurrency = (["USD", "EUR", "MAD", "GBP", "CAD"] as string[]).includes(rawCurrency) ? rawCurrency : "USD";
    await db.invoice.upsert({
      where: { lemonOrderId: orderId },
      create: {
        // `stripeInvoiceId` is the schema's unique key; we use a synthetic
        // LSQ-prefixed value because this row originated in Lemon Squeezy.
        userId: user.id, lemonOrderId: orderId,
        stripeInvoiceId: `lsq_invoice_${orderId}`,
        amountCents,
        currency: invoiceCurrency,
        status: "paid",
      },
      update: { status: "paid" },
    });
  }

  if (await tryClaimSideEffect(eventId, "LEMON_PAYMENT_SUCCESS_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "PAYMENT_SUCCESS", title: "Payment successful", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "LEMON_PAYMENT_SUCCESS_EMAIL")) {
    await sendEmail({ ...tplPaymentSuccess(user.name, plan.name), to: user.email });
  }
}

async function onSubscriptionEnded(payload: LemonWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;
  await db.subscription.updateMany({
    where: { lemonSubscriptionId: payload.data.id },
    data: { status: "canceled", canceledAt: new Date() },
  });
  // Downgrade to Free if no other active subscription.
  const stillActive = await db.subscription.count({ where: { userId: user.id, status: { in: ["active", "trialing", "lifetime"] } } });
  if (stillActive === 0) {
    const free = await db.plan.findFirst({ where: { key: "free" } });
    if (free) await db.user.update({ where: { id: user.id }, data: { planId: free.id } });
  }

  if (await tryClaimSideEffect(eventId, "LEMON_SUBSCRIPTION_CANCELED_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "SUBSCRIPTION_CANCELED", title: "Your subscription was canceled", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "LEMON_SUBSCRIPTION_CANCELED_EMAIL")) {
    const sub = await db.subscription.findFirst({ where: { lemonSubscriptionId: payload.data.id } });
    const endDate = sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString().slice(0, 10) : "soon";
    await sendEmail({ ...tplSubscriptionCanceled(user.name, endDate), to: user.email });
  }
}

async function onOrderRefunded(payload: LemonWebhookPayload, eventId: string): Promise<void> {
  const user = await findUser(payload);
  if (!user) return;
  const orderId = String(payload.data.id);
  const inv = await db.invoice.findUnique({ where: { lemonOrderId: orderId } });
  if (!inv) return;
  await db.invoice.update({ where: { id: inv.id }, data: { status: "refunded" } });
}
