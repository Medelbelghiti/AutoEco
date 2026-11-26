import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelWhopMembership, WhopApiError } from "@/lib/whop-api";
import { findActiveWhopSubscription } from "@/lib/whop-billing";
import { trackEvent } from "@/lib/analytics";
import { auditLog } from "@/lib/audit";

const Schema = z.object({ atPeriodEnd: z.boolean().optional().default(true) });

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const parsed = await parseJson(req, Schema);
  const atPeriodEnd = parsed.atPeriodEnd ?? true;

  const sub = await findActiveWhopSubscription(user.id);
  if (!sub?.whopMembershipId) {
    return NextResponse.json({ error: "No subscription to cancel" }, { status: 400 });
  }

  try {
    await cancelWhopMembership(sub.whopMembershipId, atPeriodEnd);
  } catch (e) {
    const status = e instanceof WhopApiError && e.status === 503 ? 503 : 502;
    return NextResponse.json({ error: "Could not cancel with the billing provider. Please try again." }, { status });
  }
  // Reflect it immediately; the signed webhook remains the source of truth.
  if (atPeriodEnd) {
    await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
  }
  await auditLog({ userId: user.id, action: "billing.cancel", metadata: { provider: "whop", atPeriodEnd } });
  await trackEvent("subscription_canceled", { userId: user.id });
  return ok({ ok: true, mode: atPeriodEnd ? "at_period_end" : "immediate" });
});
