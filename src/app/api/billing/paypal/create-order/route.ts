/**
 * POST /api/billing/paypal/create-order
 *
 * Start the one-time "Founder Lifetime" checkout. The amount and currency are
 * read from SERVER configuration only — any client-sent amount is ignored
 * because the request body is not read at all. The order is tagged with
 * `custom_id = user.id` so the webhook can resolve the buyer, and a
 * `PaymentOrder` row is persisted so both the webhook and the capture endpoint
 * can resolve (and idempotently claim) the grant through the PayPal order id.
 */
import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { BillingNotConfiguredError } from "@/lib/billing-errors";
import { paypalConfigured, lifetimePriceMinor, lifetimeCurrency } from "@/lib/paypal";
import { createPaypalOrder } from "@/lib/paypal-api";
import { isLifetimeUser, lifetimeGrantAvailable } from "@/lib/paypal-billing";

export const POST = withErrorHandling(async () => {
  const user = await requireUser();

  if (!paypalConfigured()) throw new BillingNotConfiguredError("PayPal");
  if (!user.emailVerifiedAt) {
    throw new AuthError("FORBIDDEN", "Verify your email before purchasing.");
  }
  if (await isLifetimeUser(user.id)) {
    return NextResponse.json({ error: "You already have lifetime access." }, { status: 409 });
  }
  if (!(await lifetimeGrantAvailable())) {
    return NextResponse.json({ error: "Lifetime access is not available." }, { status: 409 });
  }

  await enforceRateLimit({
    key: `paypal-create-order:${user.id}`,
    limit: 10,
    windowSeconds: 60 * 60,
  });

  const amountMinor = lifetimePriceMinor();
  const currency = lifetimeCurrency();

  const { orderId } = await createPaypalOrder({ amountMinor, currency, userId: user.id });

  await db.paymentOrder.create({
    data: {
      userId: user.id,
      provider: "paypal",
      providerOrderId: orderId,
      status: "created",
      amountMinor,
      currency,
    },
  });

  await auditLog({
    userId: user.id,
    action: "paypal.order.created",
    metadata: { orderId, amountMinor, currency },
  });

  return ok({ orderId, currency });
});
