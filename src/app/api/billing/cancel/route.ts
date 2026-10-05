import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelSubscription } from "@/lib/stripe";
import { cancelPaddleSubscription, PaddleApiError } from "@/lib/paddle-api";
import { trackEvent } from "@/lib/analytics";
import { auditLog } from "@/lib/audit";

const Schema = z.object({ atPeriodEnd: z.boolean().optional().default(true) });

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const parsed = await parseJson(req, Schema);
  const atPeriodEnd = parsed.atPeriodEnd ?? true;

  // Paddle is the primary provider; Stripe stays only for legacy subscribers.
  const paddleSub = await db.subscription.findFirst({
    where: { userId: user.id, paddleSubscriptionId: { not: null }, status: { in: ["active", "trialing", "past_due"] } },
    orderBy: { createdAt: "desc" },
  });
  if (paddleSub?.paddleSubscriptionId) {
    try {
      await cancelPaddleSubscription(paddleSub.paddleSubscriptionId, atPeriodEnd);
    } catch (e) {
      const status = e instanceof PaddleApiError && e.status === 503 ? 503 : 502;
      return NextResponse.json({ error: "Could not cancel with the billing provider. Please try again." }, { status });
    }
    // Reflect it immediately; the signed webhook remains the source of truth.
    if (atPeriodEnd) {
      await db.subscription.update({ where: { id: paddleSub.id }, data: { cancelAtPeriodEnd: true } });
    }
    await auditLog({ userId: user.id, action: "billing.cancel", metadata: { provider: "paddle", atPeriodEnd } });
    await trackEvent("subscription_canceled", { userId: user.id });
    return ok({ ok: true, mode: atPeriodEnd ? "at_period_end" : "immediate" });
  }

  const res = await cancelSubscription({ userId: user.id, atPeriodEnd });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  await trackEvent("subscription_canceled", { userId: user.id });
  return ok({ ok: true, mode: atPeriodEnd ? "at_period_end" : "immediate" });
});
