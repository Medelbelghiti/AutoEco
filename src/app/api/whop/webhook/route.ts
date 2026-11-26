/**
 * POST /api/whop/webhook
 *
 * Whop is the payment provider. This route is the ONLY place that grants or
 * revokes paid entitlement. It reuses the provider-neutral `WebhookEvent`
 * claim (processingToken ownership, at-least-once safe) and the
 * `WebhookSideEffect` table (each email/notification fires once).
 *
 * Signature: Standard Webhooks headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature`; see `verifyWhopSignature` for the Whop key detail.
 * Whop retries with the same `webhook-id`, which is our event id.
 *
 * Events handled (subscribe to exactly these in the Whop dashboard):
 *   membership.activated, membership.updated, membership.deactivated
 *   payment.succeeded, payment.failed
 *   refund.created, refund.updated
 *
 * Production URL: https://<domain>/api/whop/webhook
 */
import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { appOrigin } from "@/lib/seo";
import {
  verifyWhopSignature,
  whopWebhookConfigured,
  planKeyForWhopPlanId,
  mapMembershipStatus,
  readMetadata,
  readPlanId,
  readUserId,
  readMembershipId,
  parseWhopDate,
  whopMoneyToMinor,
  readCurrency,
  lifetimeMaxGrants,
  LIFETIME_PLAN_KEY,
  ACCESS_STATUSES,
  type WhopWebhookEnvelope,
} from "@/lib/whop";
import { cancelWhopMembership } from "@/lib/whop-api";
import { countLifetimeGrants, downgradeToFreeIfInactive } from "@/lib/whop-billing";
import { db } from "@/lib/db";
import { claim, reclaimStale, markProcessed, markFailed, tryClaimSideEffect } from "@/lib/webhook-state";
import { createNotification } from "@/lib/notifications";
import { sendEmail, tplPaymentSuccess, tplPaymentFailed, tplSubscriptionCanceled } from "@/lib/email";
import { coerceLocale } from "@/lib/i18n";
import { trackEvent } from "@/lib/analytics";
import { auditLog } from "@/lib/audit";

type Data = Record<string, unknown>;

export const POST = withErrorHandling(async (req) => {
  if (!whopWebhookConfigured()) {
    return NextResponse.json({ error: "Whop webhook is not configured." }, { status: 503 });
  }
  const headers = {
    id: req.headers.get("webhook-id"),
    timestamp: req.headers.get("webhook-timestamp"),
    signature: req.headers.get("webhook-signature"),
  };
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const raw = await req.text();
  if (!verifyWhopSignature(raw, headers)) {
    await auditLog({ action: "whop.webhook.signature_invalid" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhopWebhookEnvelope;
  try {
    payload = JSON.parse(raw) as WhopWebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // `webhook-id` equals the body `id` and is stable across retries.
  const eventId = headers.id;
  const eventType = payload.type;
  if (!eventType || !payload.data || typeof payload.data !== "object") {
    return NextResponse.json({ error: "Missing event type or data" }, { status: 400 });
  }

  let token = await claim(eventId, eventType);
  if (token === null) {
    token = await reclaimStale(eventId);
    if (token === null) return ok({ received: true, outcome: "skipped-other-worker" });
  }

  let sideEffectsError: unknown = null;
  try {
    await applyEvent(payload, eventId);
  } catch (e) {
    sideEffectsError = e;
  }

  if (sideEffectsError === null) {
    const finalized = await markProcessed(eventId, token);
    return ok({ received: true, outcome: finalized ? "applied" : "skipped-other-worker" });
  }
  const message = sideEffectsError instanceof Error ? sideEffectsError.message : String(sideEffectsError);
  const finalized = await markFailed(eventId, token, message);
  if (!finalized) return ok({ received: true, outcome: "skipped-other-worker" });
  await auditLog({ action: "whop.webhook.failed", metadata: { eventId, type: eventType } });
  return NextResponse.json({ error: "Webhook processing failed; retrying." }, { status: 500 });
});

async function applyEvent(payload: WhopWebhookEnvelope, eventId: string): Promise<void> {
  const data = payload.data as Data;
  switch (payload.type) {
    case "membership.activated":
    case "membership.updated":
    case "membership.deactivated":
      await onMembership(payload, data, eventId);
      return;
    case "payment.succeeded":
      await onPaymentSucceeded(data, eventId);
      return;
    case "payment.failed":
      await onPaymentFailed(payload, data, eventId);
      return;
    case "refund.created":
    case "refund.updated":
      await onRefund(payload, data, eventId);
      return;
    default:
      // Other event types are acknowledged and ignored.
      return;
  }
}

/* ------------------------------------------------------------------ */
/*                          User resolution                             */
/* ------------------------------------------------------------------ */

type BillingUser = { id: string; email: string; name: string | null; locale: string | null; whopUserId: string | null };

function toBillingUser(u: { id: string; email: string; name: string | null; locale: string | null; whopUserId: string | null; deletedAt: Date | null } | null | undefined): BillingUser | null {
  // Never grant anything to a soft-deleted account.
  if (!u || u.deletedAt) return null;
  return { id: u.id, email: u.email, name: u.name, locale: u.locale, whopUserId: u.whopUserId };
}

/**
 * Resolve the AutoEco account, first match wins:
 *   1. `metadata.userId` — set by our checkout route; the only key that can
 *      identify a brand-new buyer. Trusted because the signature was verified
 *      and Whop copies exactly the metadata our server sent.
 *   2. the membership id → an existing `Subscription.whopMembershipId`.
 *   3. the Whop user id → `User.whopUserId` (learned on first contact).
 */
async function findUser(data: Data, membershipId: string | null): Promise<BillingUser | null> {
  const { userId } = readMetadata(data);
  if (userId) {
    const u = toBillingUser(await db.user.findUnique({ where: { id: userId } }));
    if (u) return u;
  }
  if (membershipId) {
    const sub = await db.subscription.findUnique({ where: { whopMembershipId: membershipId }, include: { user: true } });
    const u = toBillingUser(sub?.user);
    if (u) return u;
  }
  const whopUserId = readUserId(data);
  if (whopUserId) {
    const u = toBillingUser(await db.user.findUnique({ where: { whopUserId } }));
    if (u) return u;
  }
  return null;
}

/** Remember the Whop user id once, without stealing it from another account. */
async function rememberWhopUser(user: BillingUser, data: Data): Promise<void> {
  const whopUserId = readUserId(data);
  if (!whopUserId || user.whopUserId) return;
  const taken = await db.user.findUnique({ where: { whopUserId }, select: { id: true } });
  if (taken) return;
  await db.user.update({ where: { id: user.id }, data: { whopUserId } });
}

/** Out-of-order guard: Whop does not guarantee delivery order. */
async function isStale(membershipId: string, at: Date): Promise<boolean> {
  const existing = await db.subscription.findUnique({ where: { whopMembershipId: membershipId }, select: { lastEventAt: true } });
  return Boolean(existing?.lastEventAt && existing.lastEventAt > at);
}

function eventTime(payload: WhopWebhookEnvelope, data: Data): Date {
  return parseWhopDate(data.updated_at) ?? parseWhopDate(payload.timestamp) ?? new Date();
}

/* ------------------------------------------------------------------ */
/*                            Memberships                               */
/* ------------------------------------------------------------------ */

/**
 * One handler for every membership event: the payload always carries the
 * membership's CURRENT state, so activated / updated / deactivated all reduce
 * to "make our row match Whop" (ordered by the membership's `updated_at`).
 */
async function onMembership(payload: WhopWebhookEnvelope, data: Data, eventId: string): Promise<void> {
  const membershipId = readMembershipId(data, true);
  if (!membershipId) return;

  const existing = await db.subscription.findUnique({ where: { whopMembershipId: membershipId }, include: { plan: true } });

  // The plan comes from the Whop plan id; a plan id we do not sell never
  // grants anything (and must not throw, or Whop would retry it forever).
  const whopPlanId = readPlanId(data);
  const planKey = planKeyForWhopPlanId(whopPlanId) ?? existing?.plan.key ?? null;
  if (!planKey) {
    await auditLog({ action: "whop.webhook.unmapped_plan", metadata: { eventId, membershipId, whopPlanId } });
    return;
  }
  const isLifetime = planKey === LIFETIME_PLAN_KEY;
  const mapped = mapMembershipStatus(typeof data.status === "string" ? data.status : null, isLifetime);
  if (!mapped) {
    await auditLog({ action: "whop.webhook.membership_status_ignored", metadata: { eventId, membershipId, status: data.status ?? null } });
    return;
  }
  const grantsAccess = (ACCESS_STATUSES as readonly string[]).includes(mapped.status);

  const user = await findUser(data, membershipId);
  if (!user) {
    await auditLog({
      action: "whop.webhook.unresolved_customer",
      metadata: { eventId, membershipId, whopUserId: readUserId(data), metadata: readMetadata(data) },
    });
    // A paid membership we cannot attribute: fail so Whop retries (the owner
    // sees the audit row). Losing access we cannot attribute is harmless.
    if (grantsAccess) throw new Error("Whop webhook: could not resolve the AutoEco user for this membership");
    return;
  }

  const at = eventTime(payload, data);
  if (await isStale(membershipId, at)) {
    await auditLog({ action: "whop.webhook.stale_event_ignored", metadata: { eventId, type: payload.type, membershipId } });
    return;
  }

  const plan = await db.plan.findUnique({ where: { key: planKey } });
  if (!plan) throw new Error(`Whop webhook: plan "${planKey}" is not seeded`);

  const periodStart = parseWhopDate(data.current_period_start) ?? existing?.currentPeriodStart ?? at;
  const periodEnd = isLifetime
    ? null
    : parseWhopDate(data.current_period_end) ?? parseWhopDate(data.expires_at) ?? existing?.currentPeriodEnd ?? null;
  const cancelAtPeriodEnd =
    mapped.status === "active" || mapped.status === "trialing"
      ? mapped.cancelAtPeriodEnd || data.cancel_at_period_end === true
      : false;
  const canceledAt = mapped.status === "canceled" ? parseWhopDate(data.canceled_at) ?? at : null;

  const wasGranting = Boolean(existing && (ACCESS_STATUSES as readonly string[]).includes(existing.status));

  // Founder Lifetime cap. Whop's plan stock should stop sales at the cap; if a
  // purchase still slips through, the buyer PAID, so we grant and flag it.
  if (mapped.status === "lifetime" && existing?.status !== "lifetime") {
    const cap = lifetimeMaxGrants();
    if ((await countLifetimeGrants()) >= cap) {
      await auditLog({ userId: user.id, action: "whop.lifetime.over_cap", metadata: { eventId, membershipId, cap } });
    }
  }

  const sub = await db.subscription.upsert({
    where: { whopMembershipId: membershipId },
    create: {
      userId: user.id,
      planId: plan.id,
      status: mapped.status,
      whopMembershipId: membershipId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      canceledAt,
      lastEventAt: at,
    },
    update: {
      planId: plan.id,
      status: mapped.status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      canceledAt,
      lastEventAt: at,
    },
  });

  await rememberWhopUser(user, data);

  if (grantsAccess) {
    await db.user.update({
      where: { id: user.id },
      // A real purchase retires the trial so a later cancellation cannot hand
      // the trial entitlements back.
      data: { planId: plan.id, trialEndsAt: null, trialUsed: true },
    });

    if (!wasGranting) {
      // Once per membership, however many activated/updated events arrive.
      if (await tryClaimSideEffect(`whop:${membershipId}`, "WHOP_SUBSCRIPTION_CREATED_ANALYTICS")) {
        await trackEvent("subscription_created", { userId: user.id, metadata: { planKey, provider: "whop", status: mapped.status } });
      }
      await stopOtherRecurringMemberships(user.id, sub.id, membershipId, eventId);
    }
  } else {
    await downgradeToFreeIfInactive(user.id);
    if (wasGranting && mapped.status === "canceled") {
      if (await tryClaimSideEffect(`whop:${membershipId}`, "WHOP_SUBSCRIPTION_CANCELED_NOTIFICATION")) {
        await createNotification({ userId: user.id, type: "SUBSCRIPTION_CANCELED", title: "Your subscription was canceled", link: "/settings/billing" });
      }
      if (await tryClaimSideEffect(`whop:${membershipId}`, "WHOP_SUBSCRIPTION_CANCELED_EMAIL")) {
        const endDate = (periodEnd ?? canceledAt ?? at).toISOString().slice(0, 10);
        await sendEmail({ ...tplSubscriptionCanceled(user.name, endDate, coerceLocale(user.locale)), to: user.email });
      }
    }
  }

  await auditLog({
    userId: user.id,
    action: "whop.membership.synced",
    metadata: { eventId, type: payload.type, membershipId, planKey, status: mapped.status },
  });
}

/**
 * A plan change on Whop is a NEW membership. When one activates, any other
 * recurring Whop membership of the same user is set to end at its period end,
 * so the customer is never billed twice and keeps what they already paid for.
 * (`getEntitlements` already prefers the newest subscription.) A failure never
 * fails the webhook: it is flagged for the owner instead.
 */
async function stopOtherRecurringMemberships(userId: string, keepSubId: string, keepMembershipId: string, eventId: string): Promise<void> {
  const others = await db.subscription.findMany({
    where: {
      userId,
      id: { not: keepSubId },
      whopMembershipId: { not: null },
      status: { in: ["active", "trialing", "past_due"] },
      cancelAtPeriodEnd: false,
    },
  });
  for (const o of others) {
    try {
      await cancelWhopMembership(o.whopMembershipId!, true);
      await db.subscription.update({ where: { id: o.id }, data: { cancelAtPeriodEnd: true } });
      await auditLog({ userId, action: "whop.switch.previous_canceled", metadata: { eventId, newMembershipId: keepMembershipId, previousMembershipId: o.whopMembershipId } });
    } catch (e) {
      await auditLog({
        userId,
        action: "whop.switch.cancel_failed",
        metadata: { eventId, previousMembershipId: o.whopMembershipId, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/*                              Payments                                */
/* ------------------------------------------------------------------ */

async function onPaymentSucceeded(data: Data, eventId: string): Promise<void> {
  const paymentId = typeof data.id === "string" ? data.id : null;
  if (!paymentId) return;
  const membershipId = readMembershipId(data, false);
  const user = await findUser(data, membershipId);
  if (!user) {
    // Entitlement comes from the membership events; an unattributed receipt is
    // logged for reconciliation rather than retried forever.
    await auditLog({ action: "whop.payment.unresolved_customer", metadata: { eventId, paymentId, membershipId } });
    return;
  }

  const amountCents = whopMoneyToMinor((data.total ?? data.final_amount ?? data.subtotal) as never);
  if (amountCents === null) {
    await auditLog({ userId: user.id, action: "whop.payment.amount_unreadable", metadata: { eventId, paymentId } });
    throw new Error("Whop webhook: payment amount could not be read");
  }
  const currency = readCurrency(data.total, data.currency);
  const paidAt = parseWhopDate(data.paid_at) ?? parseWhopDate(data.created_at);
  const planKey = planKeyForWhopPlanId(readPlanId(data));
  const plan = planKey ? await db.plan.findUnique({ where: { key: planKey }, select: { name: true } }) : null;

  await db.invoice.upsert({
    where: { whopPaymentId: paymentId },
    create: {
      userId: user.id,
      whopPaymentId: paymentId,
      // Legacy NOT NULL UNIQUE column, kept from the Stripe era.
      stripeInvoiceId: `whop_${paymentId}`,
      number: paymentId,
      amountCents,
      currency,
      status: "paid",
      planName: plan?.name ?? null,
      whopMembershipId: membershipId,
      whopPaidAt: paidAt,
    },
    update: {
      amountCents,
      currency,
      ...(membershipId ? { whopMembershipId: membershipId } : {}),
      ...(paidAt ? { whopPaidAt: paidAt } : {}),
    },
  });

  await rememberWhopUser(user, data);

  if (await tryClaimSideEffect(eventId, "WHOP_PAYMENT_SUCCESS_NOTIFICATION")) {
    await createNotification({ userId: user.id, type: "PAYMENT_SUCCESS", title: "Payment successful", link: "/settings/billing" });
  }
  if (await tryClaimSideEffect(eventId, "WHOP_PAYMENT_SUCCESS_EMAIL")) {
    await sendEmail({ ...tplPaymentSuccess(user.name, plan?.name ?? "AutoEco", coerceLocale(user.locale)), to: user.email });
  }
}

/**
 * A payment failed (usually a renewal). Whop retries the charge, so the
 * membership becomes `past_due` and `getEntitlements` keeps a bounded grace
 * period. The customer must be told, or they silently lose paid features.
 */
async function onPaymentFailed(payload: WhopWebhookEnvelope, data: Data, eventId: string): Promise<void> {
  const membershipId = readMembershipId(data, false);
  const user = await findUser(data, membershipId);
  if (!user) return;

  if (membershipId) {
    const at = eventTime(payload, data);
    if (!(await isStale(membershipId, at))) {
      // Never flip a lifetime grant or an ended subscription to past_due.
      await db.subscription.updateMany({
        where: { whopMembershipId: membershipId, status: { notIn: ["lifetime", "canceled"] } },
        data: { status: "past_due", lastEventAt: at },
      });
    }
  }

  await auditLog({ userId: user.id, action: "whop.payment_failed", metadata: { eventId, membershipId, paymentId: data.id ?? null } });

  if (await tryClaimSideEffect(eventId, "WHOP_PAYMENT_FAILED_NOTIFICATION")) {
    await createNotification({
      userId: user.id,
      type: "PAYMENT_FAILED",
      title: "Payment failed — action required",
      body: "We could not process your last payment. Update your payment method to keep your paid features.",
      link: "/settings/billing",
    });
  }
  if (await tryClaimSideEffect(eventId, "WHOP_PAYMENT_FAILED_EMAIL")) {
    await sendEmail({ ...tplPaymentFailed(user.name, appOrigin(), coerceLocale(user.locale)), to: user.email });
  }
}

/* ------------------------------------------------------------------ */
/*                              Refunds                                 */
/* ------------------------------------------------------------------ */

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Refund rule (same as the previous provider):
 *   - Only a `succeeded` refund is applied; each refund id is applied once.
 *   - The invoice records the cumulative refunded amount.
 *   - A FULL refund of a Founder Lifetime payment revokes lifetime access.
 *   - A FULL refund of the LATEST payment of a recurring membership ends the
 *     membership immediately; refunds of older payments keep access.
 *   - A failed provider cancel never fails the webhook; it is flagged.
 */
async function onRefund(payload: WhopWebhookEnvelope, data: Data, eventId: string): Promise<void> {
  if (data.status !== "succeeded") return;
  const refundId = typeof data.id === "string" ? data.id : null;
  const paymentId =
    (typeof data.payment_id === "string" ? data.payment_id : null) ??
    (data.payment && typeof (data.payment as Data).id === "string" ? ((data.payment as Data).id as string) : null);
  if (!refundId || !paymentId) return;

  const invoice = await db.invoice.findUnique({ where: { whopPaymentId: paymentId } });
  if (!invoice) {
    await auditLog({ action: "whop.refund.unknown_payment", metadata: { eventId, refundId, paymentId } });
    return;
  }
  const refundCents = whopMoneyToMinor(data.amount as never) ?? 0;
  const currency = readCurrency(data.amount, invoice.currency);

  let refundedTotal: number;
  try {
    refundedTotal = await db.$transaction(async (tx) => {
      const prior = await tx.refundAdjustment.aggregate({ where: { transactionId: paymentId }, _sum: { amountCents: true } });
      const total = (prior._sum.amountCents ?? 0) + refundCents;
      const full = invoice.amountCents > 0 && total >= invoice.amountCents;
      await tx.refundAdjustment.create({
        data: { adjustmentId: refundId, transactionId: paymentId, amountCents: refundCents, currency, type: full ? "full" : "partial" },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { refundedAmountCents: total, status: full ? "refunded" : "partially_refunded" },
      });
      return total;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return; // already applied (created→updated pair, or a retry)
    throw e;
  }

  await auditLog({ userId: invoice.userId, action: "whop.refund.recorded", metadata: { eventId, refundId, paymentId, refundedTotal, currency } });

  if (!(invoice.amountCents > 0 && refundedTotal >= invoice.amountCents)) return; // partial: keep access
  const membershipId = invoice.whopMembershipId;
  if (!membershipId) {
    await auditLog({ userId: invoice.userId, action: "whop.refund.no_membership", metadata: { eventId, refundId, paymentId } });
    return;
  }
  const sub = await db.subscription.findUnique({ where: { whopMembershipId: membershipId } });
  if (!sub) return;

  if (sub.status === "lifetime") {
    const at = eventTime(payload, data);
    await db.subscription.update({ where: { id: sub.id }, data: { status: "canceled", canceledAt: at, lastEventAt: at } });
    await downgradeToFreeIfInactive(sub.userId);
    await auditLog({ userId: sub.userId, action: "whop.refund.lifetime_revoked", metadata: { eventId, refundId, membershipId } });
    await cancelAtProvider(sub.userId, membershipId, eventId, refundId);
    return;
  }

  // Recurring: only the latest payment of this membership revokes access.
  const latest = await db.invoice.findFirst({
    where: { whopMembershipId: membershipId, status: { in: ["paid", "refunded", "partially_refunded"] } },
    orderBy: [{ whopPaidAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!latest || latest.id !== invoice.id) {
    await auditLog({ userId: sub.userId, action: "whop.refund.older_payment", metadata: { eventId, refundId, membershipId } });
    return;
  }
  // The `membership.updated` that follows downgrades local entitlement.
  await cancelAtProvider(sub.userId, membershipId, eventId, refundId);
}

async function cancelAtProvider(userId: string, membershipId: string, eventId: string, refundId: string): Promise<void> {
  try {
    await cancelWhopMembership(membershipId, false);
    await auditLog({ userId, action: "whop.refund.membership_canceled", metadata: { eventId, refundId, membershipId } });
  } catch (e) {
    await auditLog({
      userId,
      action: "whop.refund.cancel_failed",
      metadata: { eventId, refundId, membershipId, error: e instanceof Error ? e.message : String(e) },
    });
  }
}
