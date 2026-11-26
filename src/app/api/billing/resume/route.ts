import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uncancelWhopMembership } from "@/lib/whop-api";
import { findActiveWhopSubscription } from "@/lib/whop-billing";
import { auditLog } from "@/lib/audit";

export const POST = withErrorHandling(async () => {
  const user = await requireUser();

  const sub = await findActiveWhopSubscription(user.id);
  if (!sub?.whopMembershipId) {
    return NextResponse.json({ error: "No subscription to resume" }, { status: 400 });
  }
  try {
    await uncancelWhopMembership(sub.whopMembershipId);
  } catch {
    return NextResponse.json({ error: "Could not resume with the billing provider. Please try again." }, { status: 502 });
  }
  await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
  await auditLog({ userId: user.id, action: "billing.resume", metadata: { provider: "whop" } });
  return ok({ ok: true });
});
