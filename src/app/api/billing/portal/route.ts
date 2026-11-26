/**
 * POST /api/billing/portal
 *
 * Returns Whop's own management page for the user's most recent Whop
 * membership (update payment method, receipts, cancel). The URL is fetched
 * server-side with the API key and never derived from client input.
 */
import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWhopManageUrl } from "@/lib/whop-api";

export const POST = withErrorHandling(async () => {
  const user = await requireUser();

  const sub = await db.subscription.findFirst({
    where: { userId: user.id, whopMembershipId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { whopMembershipId: true },
  });
  if (!sub?.whopMembershipId) {
    return NextResponse.json({ error: "No billing account for this user yet" }, { status: 400 });
  }
  try {
    return ok({ url: await getWhopManageUrl(sub.whopMembershipId) });
  } catch {
    return NextResponse.json({ error: "Could not open the billing portal. Please try again." }, { status: 502 });
  }
});
