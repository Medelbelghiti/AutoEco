/**
 * POST /api/billing/paypal/capture-order
 *
 * Confirms an approved PayPal order server-side. Access is granted from the
 * SERVER's re-read of PayPal's own order state — never from a client claim —
 * and only via the shared, idempotent `grantLifetime` claim, so a double
 * submit (or the later webhook) cannot grant twice. The webhook remains the
 * authoritative path; this endpoint just lets the buyer in immediately.
 */
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { BillingNotConfiguredError } from "@/lib/billing-errors";
import { paypalConfigured } from "@/lib/paypal";
import { capturePaypalOrder, getPaypalOrder, PaypalApiError } from "@/lib/paypal-api";
import { grantLifetime, emitLifetimePurchaseEffects } from "@/lib/paypal-billing";

const bodySchema = { orderId: "string" };

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();

  if (!paypalConfigured()) throw new BillingNotConfiguredError("PayPal");

  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown };
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId || orderId.length > 64) {
    return Response.json({ error: "Invalid order id." }, { status: 400 });
  }

  const order = await db.paymentOrder.findUnique({ where: { providerOrderId: orderId } });
  // Never reveal another user's order.
  if (!order || order.userId !== user.id) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  if (order.status === "captured" || order.status === "partially_refunded") {
    return ok({ status: "already" });
  }

  let view;
  try {
    view = await capturePaypalOrder(orderId);
  } catch (e) {
    // An already-captured order returns an error; re-read it instead of failing.
    if (e instanceof PaypalApiError && e.status === 422) {
      view = await getPaypalOrder(orderId);
    } else {
      throw e;
    }
  }

  if (view.status !== "COMPLETED" || view.captureStatus !== "COMPLETED") {
    return Response.json({ error: "Payment is not complete." }, { status: 409 });
  }

  const outcome = await grantLifetime({
    orderId,
    captureId: view.captureId,
    eventAt: new Date(),
  });

  if (!outcome.granted && outcome.reason === "cap-reached") {
    await auditLog({ userId: user.id, action: "paypal.capture.cap_reached", metadata: { orderId } });
    return Response.json({ error: "Lifetime access is not available." }, { status: 409 });
  }

  await emitLifetimePurchaseEffects({
    orderId,
    userId: user.id,
    planName: outcome.granted ? outcome.planName : "Founder Lifetime",
  });

  await auditLog({
    userId: user.id,
    action: "paypal.capture.confirmed",
    metadata: { orderId, captureId: view.captureId, result: outcome.granted ? "granted" : outcome.reason },
  });

  return ok({ status: outcome.granted ? "granted" : "already" });
});
