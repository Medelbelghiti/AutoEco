import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireStripe } from "@/lib/stripe-client";
import { removePaddleScheduledCancellation } from "@/lib/paddle-api";

export const POST = withErrorHandling(async () => {
  const user = await requireUser();

  const paddleSub = await db.subscription.findFirst({
    where: { userId: user.id, paddleSubscriptionId: { not: null }, status: { in: ["active", "trialing", "past_due"] } },
    orderBy: { createdAt: "desc" },
  });
  if (paddleSub?.paddleSubscriptionId) {
    try {
      await removePaddleScheduledCancellation(paddleSub.paddleSubscriptionId);
    } catch {
      return NextResponse.json({ error: "Could not resume with the billing provider. Please try again." }, { status: 502 });
    }
    await db.subscription.update({ where: { id: paddleSub.id }, data: { cancelAtPeriodEnd: false } });
    return ok({ ok: true });
  }

  const sub = await db.subscription.findFirst({
    where: { userId: user.id, stripeSubscriptionId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub?.stripeSubscriptionId) {
    return NextResponse.json({ error: "No subscription to resume" }, { status: 400 });
  }
  const stripe = requireStripe();
  await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
  await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
  return ok({ ok: true });
});
