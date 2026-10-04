/**
 * POST /api/cron/expire-subscriptions
 *
 * Paddle is the source of truth for subscription state, but it will not
 * re-deliver a webhook we already acknowledged. If `subscription.past_due`
 * was lost, or a customer simply never re-pays, the local row would stay
 * `active` forever.
 *
 * `getEntitlements()` already bounds `past_due` with a grace window and
 * `active` with `currentPeriodEnd`, so this is not an entitlement-security
 * hole — it is a data-hygiene job that keeps `Subscription` truthful and
 * re-notifies customers whose payment is genuinely dead.
 *
 * Safe to run repeatedly.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cron";
import { getFreePlan } from "@/lib/plans";
import { sendEmail, tplPaymentFailed } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { auditLog } from "@/lib/audit";
import { captureException } from "@/lib/error-capture";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const denied = await verifyCronRequest(req);
  if (denied) return denied;

  const now = new Date();
  const summary = { expired: 0, revertedToFree: 0, notified: 0, failed: 0 };

  // --- 1. Cancel subscriptions whose paid period has fully elapsed. -------
  const stale = await db.subscription.findMany({
    where: {
      status: { in: ["active", "trialing", "past_due"] },
      currentPeriodEnd: { not: null, lt: now },
      cancelAtPeriodEnd: { not: true },
    },
    include: { user: true, plan: true },
    take: 200,
  });

  for (const sub of stale) {
    if (sub.user.deletedAt) continue;
    try {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "expired", canceledAt: sub.canceledAt ?? now },
      });
      summary.expired++;

      // They thought they were paying. Tell them, then drop them to free.
      const anyStillActive = await db.subscription.count({
        where: {
          userId: sub.userId,
          id: { not: sub.id },
          status: { in: ["active", "trialing", "past_due", "lifetime"] },
          OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
        },
      });
      if (anyStillActive === 0) {
        const free = await getFreePlan();
        if (free) {
          await db.user.update({
            where: { id: sub.userId },
            data: { planId: free.id, trialEndsAt: null },
          });
          summary.revertedToFree++;
        }
        await createNotification({
          userId: sub.userId,
          type: "SUBSCRIPTION_CANCELED",
          title: "Your paid period has ended",
          body: "You are back on the Free plan. Upgrade any time to restore your paid features.",
          link: "/pricing",
        });
        await sendEmail({
          ...tplPaymentFailed(sub.user.name, env.appUrl),
          to: sub.user.email,
        });
        summary.notified++;
      }

      await auditLog({
        action: "cron.subscription_expired",
        userId: sub.userId,
        metadata: { subscriptionId: sub.id, plan: sub.plan.key },
      });
    } catch (e) {
      summary.failed++;
      await captureException(e, { scope: "cron.expire-subscriptions", userId: sub.userId });
    }
  }

  await auditLog({
    action: "cron.expire_completed",
    metadata: summary as unknown as Record<string, unknown>,
  });
  return NextResponse.json({ ok: summary.failed === 0, ...summary });
}