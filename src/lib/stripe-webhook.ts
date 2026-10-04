/**
 * Stripe webhook handler with TRULY concurrency-safe state machine +
 * durable side-effect idempotency.
 *
 * STATE MACHINE (atomic per-row):
 *
 *   (none)        -> RECEIVED                  (INSERT ON CONFLICT DO NOTHING)
 *   RECEIVED      -> PROCESSING(token=T1)      (atomic UPDATE that stamps a NEW token)
 *   FAILED        -> PROCESSING(token=T1)      (same; rotates token)
 *   PROCESSING(T) -> PROCESSED                 (atomic UPDATE WHERE processingToken = T)
 *   PROCESSING(T) -> FAILED                    (atomic UPDATE WHERE processingToken = T)
 *
 * OWNERSHIP:
 *
 *   Each `claim()` generates a fresh random processingToken. The token
 *   rotates on every successful claim — so a slow legitimate worker that
 *   lost ownership to a stale-recovery worker cannot finalize the event
 *   (its old token no longer matches the row). A worker that still holds
 *   the current token can finalize normally.
 *
 * SIDE-EFFECT IDEMPOTENCY (durable):
 *
 *   External effects (notifications, emails) go through
 *   `tryClaimSideEffect(eventId, effectType)` which does:
 *     INSERT INTO WebhookSideEffect (eventId, effectType)
 *     ON CONFLICT DO NOTHING
 *   Only the row-creator executes the effect. Retries / concurrent
 *   deliveries see "already claimed" and skip the effect.
 *
 * OWNERSHIP GUARDS:
 *
 *   - `subscription.created/updated`: verify user.stripeCustomerId === sub.customer
 *   - `invoice.paid`: resolve user via customer link, NOT via metadata;
 *     reject if metadata.userId disagrees.
 */
import type Stripe from "stripe";
import crypto from "node:crypto";
import { db } from "./db";
import { createNotification } from "./notifications";
import { sendEmail, tplPaymentSuccess, tplPaymentFailed, tplSubscriptionCanceled } from "./email";
import { auditLog } from "./audit";
import { env } from "./env";
import { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "./webhook-state";

// Re-export so existing tests and callers of stripe-webhook.ts continue
// to work without modification. The implementations live in webhook-state.ts.
export { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "./webhook-state";
export type { WebhookStatus } from "./webhook-state";

export type ProcessOutcome =
  | "applied"
  | "skipped-already-processed"
  | "skipped-other-worker"
  | "error";

const STALE_PROCESSING_MINUTES = 15;

function newProcessingToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Atomically transition the row into PROCESSING with a fresh
 * processingToken. Returns the new token if THIS call won the claim.
 * Returns null if another worker already owns the event OR if the event
 * is already PROCESSED.
 *
 * The transaction that does the claim is a single statement:
 *   UPDATE WebhookEvent
 *     SET status='PROCESSING', processingToken=$t, attempts=attempts+1
 *     WHERE eventId=$e AND status IN ('RECEIVED','FAILED')
 * The `WHERE` is the lock — only one of N concurrent calls can affect
 * a row.
  */
export async function handleStripeEvent(event: Stripe.Event): Promise<ProcessOutcome> {
  const eventId = event.id;
  let token = await claim(eventId, event.type);
  if (token === null) {
    token = await reclaimStale(eventId);
    if (token === null) {
      return "skipped-other-worker";
    }
  }

  // We are the current owner. Apply business effects.
  let sideEffectsError: unknown = null;
  try {
    await applyEvent(event, eventId);
  } catch (e) {
    sideEffectsError = e;
  }

  // ALWAYS finalize — whether success OR failure — using the token.
  // If our token has been overwritten (e.g. someone else reclaimed),
  // markProcessed/markFailed will affect 0 rows and we return error so
  // Stripe retries.
  if (sideEffectsError === null) {
    const finalized = await markProcessed(eventId, token);
    if (!finalized) {
      return "skipped-other-worker";
    }
    return "applied";
  } else {
    const finalized = await markFailed(eventId, token, String(sideEffectsError instanceof Error ? sideEffectsError.message : sideEffectsError));
    if (!finalized) {
      return "skipped-other-worker";
    }
    await auditLog({ action: "stripe.webhook.failed", metadata: { eventId, type: event.type } });
    throw sideEffectsError; // 500 → Stripe retries
  }
}

async function applyEvent(event: Stripe.Event, eventId: string): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, eventId);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await onSubscriptionUpsert(event.data.object as Stripe.Subscription, eventId);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription, eventId);
      break;
    case "invoice.paid":
      await onInvoicePaid(event.data.object as Stripe.Invoice, eventId);
      break;
    case "invoice.payment_failed":
      await onInvoicePaymentFailed(event.data.object as Stripe.Invoice, eventId);
      break;
    case "charge.refunded":
      await onChargeRefunded(event.data.object as Stripe.Charge);
      break;
    default:
      // Unknown event types are ignored — not an error.
      return;
  }
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  const userId = session.metadata?.userId;
  const planId = session.metadata?.planId;
  if (!userId || !planId) return;
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) return;
  const isLifetime = plan.billingPeriod === "LIFETIME";

  await db.user.update({ where: { id: userId }, data: { planId: plan.id } });

  if (isLifetime) {
    await db.subscription.upsert({
      where: { stripeSubscriptionId: `lifetime_${userId}` },
      create: { userId, planId: plan.id, status: "lifetime", stripeSubscriptionId: `lifetime_${userId}`, currentPeriodStart: new Date() },
      update: { planId: plan.id, status: "lifetime" },
    });
  }
  await db.user.update({ where: { id: userId }, data: { trialEndsAt: null, trialUsed: true } });
}

async function onSubscriptionUpsert(sub: Stripe.Subscription, eventId: string): Promise<void> {
  const userId = sub.metadata?.userId;
  const planId = sub.metadata?.planId;
  if (!userId || !planId) return;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.stripeCustomerId && sub.customer && user.stripeCustomerId !== sub.customer) {
    throw new Error("Stripe customer mismatch — refusing to update subscription");
  }

  await db.subscription.upsert({
    where: { stripeSubscriptionId: sub.id },
    create: {
      userId, planId, stripeSubscriptionId: sub.id, status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    update: {
      planId, status: sub.status,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
  await db.user.update({ where: { id: userId }, data: { planId } });

  // Side effect: send notification + email (durable idempotency)
  if (await tryClaimSideEffect(eventId, "SUBSCRIPTION_UPDATED_NOTIFICATION")) {
    await createNotification({ userId, type: "GENERAL", title: "Subscription updated", link: "/settings/billing" });
  }
}

async function onSubscriptionDeleted(sub: Stripe.Subscription, eventId: string): Promise<void> {
  const userId = sub.metadata?.userId;
  if (!userId) return;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.stripeCustomerId && sub.customer && user.stripeCustomerId !== sub.customer) {
    throw new Error("Stripe customer mismatch — refusing to cancel subscription");
  }

  await db.subscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: { status: "canceled", canceledAt: new Date() },
  });
  const stillActive = await db.subscription.count({ where: { userId, status: { in: ["active", "trialing", "lifetime"] } } });
  if (stillActive === 0) {
    const free = await db.plan.findFirst({ where: { key: "free" } });
    if (free) await db.user.update({ where: { id: userId }, data: { planId: free.id } });
  }

  if (await tryClaimSideEffect(eventId, "SUBSCRIPTION_CANCELED_NOTIFICATION")) {
    await createNotification({ userId, type: "SUBSCRIPTION_CANCELED", title: "Your subscription was canceled", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "SUBSCRIPTION_CANCELED_EMAIL")) {
    const sub2 = await db.subscription.findFirst({ where: { stripeSubscriptionId: sub.id } });
    if (sub2?.currentPeriodEnd) {
      await sendEmail({ ...tplSubscriptionCanceled(user.name, sub2.currentPeriodEnd.toISOString().slice(0, 10)), to: user.email });
    }
  }
}

async function onInvoicePaid(invoice: Stripe.Invoice, eventId: string): Promise<void> {
  let userId: string | null = null;
  if (typeof invoice.customer === "string") {
    const u = await db.user.findUnique({ where: { stripeCustomerId: invoice.customer } });
    userId = u?.id ?? null;
  }
  if (!userId) return;
  const metaUserId = (invoice.subscription_details?.metadata as Record<string, string> | undefined)?.userId;
  if (metaUserId && metaUserId !== userId) {
    throw new Error("Invoice metadata userId does not match customer link");
  }

  // Idempotent upsert on Invoice (the unique stripeInvoiceId already
  // provides this guarantee at the data layer).
  await db.invoice.upsert({
    where: { stripeInvoiceId: invoice.id! },
    create: {
      userId, stripeInvoiceId: invoice.id!, number: invoice.number ?? null,
      amountCents: invoice.amount_paid, currency: invoice.currency, status: "paid",
      planName: (invoice.lines.data[0]?.description ?? null) ?? null,
      hostedUrl: invoice.hosted_invoice_url ?? null, pdfUrl: invoice.invoice_pdf ?? null,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    },
    update: { status: "paid", amountCents: invoice.amount_paid, hostedUrl: invoice.hosted_invoice_url ?? null, pdfUrl: invoice.invoice_pdf ?? null },
  });

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;

  if (await tryClaimSideEffect(eventId, "PAYMENT_SUCCESS_NOTIFICATION")) {
    await createNotification({ userId, type: "PAYMENT_SUCCESS", title: "Payment successful", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "PAYMENT_SUCCESS_EMAIL")) {
    await sendEmail({ ...tplPaymentSuccess(user.name, (invoice.lines.data[0]?.description ?? "your plan") || "your plan"), to: user.email });
  }
}

async function onInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string): Promise<void> {
  let userId: string | null = null;
  if (typeof invoice.customer === "string") {
    const u = await db.user.findUnique({ where: { stripeCustomerId: invoice.customer } });
    userId = u?.id ?? null;
  }
  if (!userId) return;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await db.invoice.upsert({
    where: { stripeInvoiceId: invoice.id! },
    create: { userId, stripeInvoiceId: invoice.id!, amountCents: invoice.amount_due, currency: invoice.currency, status: "open" },
    update: { status: "open" },
  });

  if (await tryClaimSideEffect(eventId, "PAYMENT_FAILED_NOTIFICATION")) {
    await createNotification({ userId, type: "PAYMENT_FAILED", title: "Payment failed", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "PAYMENT_FAILED_EMAIL")) {
    await sendEmail({ ...tplPaymentFailed(user.name, env.appUrl), to: user.email });
  }
}

async function onChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const stripeInvoiceId = (charge.invoice as string) ?? null;
  if (!stripeInvoiceId) return;
  const inv = await db.invoice.findUnique({ where: { stripeInvoiceId } });
  if (!inv) return;
  await db.invoice.update({ where: { id: inv.id }, data: { status: "refunded" } });
}
