import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { db } from "@/lib/db";
import { destroySession, requireUser, hashPassword } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { randomBytes } from "node:crypto";
import { cancelPaddleSubscription } from "@/lib/paddle-api";

export const DELETE = withErrorHandling(async () => {
  const user = await requireUser();

  // Stop billing BEFORE anonymising: a deleted account must never be charged
  // again. If the provider call fails we abort and keep the account intact so
  // the user can retry (or cancel from the billing portal) instead of being
  // silently billed with no way to log in.
  const activePaddle = await db.subscription.findMany({
    where: { userId: user.id, paddleSubscriptionId: { not: null }, status: { in: ["active", "trialing", "past_due"] } },
    select: { paddleSubscriptionId: true },
  });
  for (const s of activePaddle) {
    try {
      await cancelPaddleSubscription(s.paddleSubscriptionId!, false);
    } catch {
      return NextResponse.json(
        { error: "We could not cancel your subscription with the billing provider, so your account was not deleted. Please try again or cancel from Settings → Billing first." },
        { status: 502 }
      );
    }
  }

  // `passwordHash` is NOT NULL in the schema, so the credential cannot simply
  // be set to null. Instead it is overwritten with a hash of a fresh random
  // secret that is discarded immediately and never stored: the resulting hash
  // is irreversible, unlinked to any real password, and can never be matched
  // by `verifyPassword`. This erases the credential rather than leaving it
  // sitting in the database after the account is "deleted".
  await db.user.update({
    where: { id: user.id },
    data: {
      deletedAt: new Date(),
      // `.invalid` is reserved by RFC 2606 and can never be delivered to.
      email: `deleted-${user.id}@deleted.invalid`,
      name: null,
      passwordHash: await hashPassword(randomBytes(32).toString("hex")),
      // Clear BOTH processor links: leaving `paddleCustomerId` behind would
      // re-link the anonymised account to a real payer at the provider.
      stripeCustomerId: null,
      paddleCustomerId: null,
    },
  });
  await db.apiKey.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await auditLog({ userId: user.id, action: "account.deleted" });
  destroySession();
  return ok({ ok: true });
});
