/**
 * POST /api/paypal/webhook
 *
 * The authoritative PayPal event receiver. Reuses the existing
 * `WebhookEvent` state machine (claim / reclaimStale / markProcessed /
 * markFailed) and the `WebhookSideEffect` idempotency table — NO parallel
 * mechanism is created.
 *
 * Security posture:
 *   - The signature is verified through PayPal's own
 *     `verify-webhook-signature` API and FAILS CLOSED (missing header,
 *     unparseable body, network error or non-SUCCESS all reject the event).
 *   - A grant is only ever issued by the idempotent `grantLifetime` claim on
 *     the stored `PaymentOrder`, so replays and out-of-order deliveries are
 *     safe.
 *   - Unknown orders/users are audited and answered 200 (never retried
 *     forever), never granted.
 *
 * Production URL: https://<domain>/api/paypal/webhook (configure in the
 * PayPal app's webhook settings, with its Webhook ID as PAYPAL_WEBHOOK_ID).
 */
import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { paypalConfigured, paypalAmountToMinor } from "@/lib/paypal";
import { verifyPaypalWebhookSignature } from "@/lib/paypal-api";
import { db } from "@/lib/db";
import { claim, reclaimStale, markProcessed, markFailed } from "@/lib/webhook-state";
import { auditLog } from "@/lib/audit";
import {
  grantLifetime,
  applyRefund,
  denyOrder,
  emitLifetimePurchaseEffects,
} from "@/lib/paypal-billing";

interface PaypalWebhookPayload {
  id?: string;
  event_type?: string;
  create_time?: string;
  resource?: Record<string, unknown>;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function eventTime(payload: PaypalWebhookPayload): Date {
  const d = payload.create_time ? new Date(payload.create_time) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function orderIdFrom(resource: Record<string, unknown>): string | null {
  const related = asRecord(asRecord(resource.supplementary_data).related_ids);
  return asString(related.order_id);
}

function refundedMinorOf(resource: Record<string, unknown>): number | null {
  const breakdown = asRecord(resource.seller_receivable_breakdown);
  return paypalAmountToMinor(asRecord(breakdown.refunded_amount).value);
}

function refundIsPartial(resource: Record<string, unknown>): boolean {
  const status = (asString(resource.status) ?? "").toUpperCase();
  if (status === "PARTIALLY_REFUNDED") return true;
  if (status === "REFUNDED") return false;
  const total = paypalAmountToMinor(asRecord(resource.amount).value);
  const refunded = refundedMinorOf(resource);
  if (total != null && refunded != null) return refunded > 0 && refunded < total;
  return false;
}

export const POST = withErrorHandling(async (req) => {
  if (!paypalConfigured()) {
    return NextResponse.json({ error: "PayPal webhook is not configured." }, { status: 503 });
  }

  const raw = await req.text();
  const verified = await verifyPaypalWebhookSignature({ headers: req.headers, rawBody: raw });
  if (!verified) {
    await auditLog({ action: "paypal.webhook.signature_invalid" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: PaypalWebhookPayload;
  try {
    payload = JSON.parse(raw) as PaypalWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = payload.id;
  const eventType = payload.event_type;
  if (!eventId || !eventType) {
    return NextResponse.json({ error: "Missing event id or type" }, { status: 400 });
  }

  let token = await claim(eventId, eventType);
  if (!token) token = await reclaimStale(eventId);
  if (!token) return ok({ outcome: "skipped" });

  try {
    await applyEvent(payload, eventId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(eventId, token, message);
    await auditLog({ action: "paypal.webhook.failed", metadata: { eventId, type: eventType } });
    return NextResponse.json({ error: "Webhook processing failed; retrying." }, { status: 500 });
  }

  if (!(await markProcessed(eventId, token))) return ok({ outcome: "skipped" });
  return ok({ outcome: "processed" });
});

async function applyEvent(payload: PaypalWebhookPayload, eventId: string): Promise<void> {
  const type = payload.event_type ?? "";
  // Only capture lifecycle events are in scope; anything else is a no-op.
  if (!type.startsWith("PAYMENT.CAPTURE.")) return;

  const resource = asRecord(payload.resource);
  const orderId = orderIdFrom(resource);
  if (!orderId) {
    await auditLog({ action: "paypal.webhook.unknown_order", metadata: { eventId, type, reason: "no_order_id" } });
    return;
  }

  const order = await db.paymentOrder.findUnique({ where: { providerOrderId: orderId } });
  if (!order) {
    await auditLog({ action: "paypal.webhook.unknown_order", metadata: { eventId, type, orderId } });
    return;
  }

  const at = eventTime(payload);
  if (order.lastEventAt && order.lastEventAt > at) {
    await auditLog({
      userId: order.userId,
      action: "paypal.webhook.stale_event_ignored",
      metadata: { eventId, type, orderId },
    });
    return;
  }

  // The order's own user id must match what we tagged the order with.
  const customId = asString(resource.custom_id);
  if (customId && customId !== order.userId) {
    await auditLog({
      userId: order.userId,
      action: "paypal.webhook.custom_id_mismatch",
      metadata: { eventId, type, orderId },
    });
    return;
  }

  const user = await db.user.findUnique({
    where: { id: order.userId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    await auditLog({
      action: "paypal.webhook.unknown_user",
      metadata: { eventId, type, orderId, userId: order.userId },
    });
    return;
  }

  switch (payload.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const outcome = await grantLifetime({
        orderId,
        captureId: asString(resource.id),
        eventAt: at,
      });
      if (!outcome.granted && outcome.reason === "cap-reached") {
        await auditLog({ userId: order.userId, action: "paypal.lifetime.cap_reached", metadata: { eventId, orderId } });
        return;
      }
      await emitLifetimePurchaseEffects({
        orderId,
        userId: order.userId,
        planName: outcome.granted ? outcome.planName : "Founder Lifetime",
      });
      await auditLog({
        userId: order.userId,
        action: "paypal.lifetime.granted",
        metadata: { eventId, orderId, result: outcome.granted ? "granted" : outcome.reason },
      });
      return;
    }


    case "PAYMENT.CAPTURE.REFUNDED": {
      const partial = refundIsPartial(asRecord(payload.resource));
      const refundedMinor = refundedMinorOf(asRecord(payload.resource));
      await applyRefund({ orderId, partial, refundedMinor, eventAt: at });
      await auditLog({
        userId: order.userId,
        action: partial ? "paypal.lifetime.refund_recorded" : "paypal.lifetime.revoked",
        metadata: { eventId, orderId, partial, refundedMinor },
      });
      return;
    }

    case "PAYMENT.CAPTURE.REVERSED":
    case "PAYMENT.CAPTURE.DENIED": {
      if (order.status === "created" || order.status === "pending") {
        await denyOrder(orderId, at);
        await auditLog({
          userId: order.userId,
          action: "paypal.lifetime.denied",
          metadata: { eventId, orderId, via: type },
        });
        return;
      }
      await applyRefund({ orderId, partial: false, refundedMinor: null, eventAt: at });
      await auditLog({
        userId: order.userId,
        action: "paypal.lifetime.revoked",
        metadata: { eventId, orderId, via: type },
      });
      return;
    }

    default:
      return;
  }
}
