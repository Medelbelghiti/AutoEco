import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createBillingPortalSession } from "@/lib/stripe";
import { createPaddlePortalUrl } from "@/lib/paddle-api";
import { env } from "@/lib/env";

export const POST = withErrorHandling(async () => {
  const user = await requireUser();

  if (user.paddleCustomerId) {
    const subs = await db.subscription.findMany({
      where: { userId: user.id, paddleSubscriptionId: { not: null } },
      select: { paddleSubscriptionId: true },
      take: 5,
    });
    try {
      const url = await createPaddlePortalUrl(
        user.paddleCustomerId,
        subs.map((s: { paddleSubscriptionId: string | null }) => s.paddleSubscriptionId!).filter(Boolean)
      );
      return ok({ url });
    } catch {
      return NextResponse.json({ error: "Could not open the billing portal. Please try again." }, { status: 502 });
    }
  }

  if (user.stripeCustomerId) {
    const res = await createBillingPortalSession(user.stripeCustomerId, `${env.appUrl}/settings`);
    return ok({ url: res.url });
  }
  return NextResponse.json({ error: "No billing account for this user yet" }, { status: 400 });
});
