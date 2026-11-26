/**
 * POST /api/billing/checkout  { planKey: "pro" | "pro_plus" | "lifetime" }
 *
 * Creates a Whop hosted checkout for the signed-in user and returns its URL;
 * the browser then navigates there. The price comes from the Whop plan that
 * the SERVER maps the plan key to — nothing price-related is read from the
 * request. `metadata.userId` lets the webhook attribute the purchase.
 *
 * Nothing is granted here: the signed webhook is the only source of
 * entitlement.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { BillingNotConfiguredError } from "@/lib/billing-errors";
import { appOrigin } from "@/lib/seo";
import { whopPlanPurchasable, LIFETIME_PLAN_KEY, type WhopPlanKey } from "@/lib/whop";
import { createWhopCheckout, WhopApiError } from "@/lib/whop-api";
import { isLifetimeUser, lifetimeGrantAvailable } from "@/lib/whop-billing";

const Schema = z.object({ planKey: z.enum(["pro", "pro_plus", "lifetime"]) });

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const { planKey } = await parseJson(req, Schema);

  if (!whopPlanPurchasable(planKey)) throw new BillingNotConfiguredError("Whop");

  // Paying customers must be reachable for receipts and billing notices, and
  // throwaway signups must not be able to start checkouts.
  if (!user.emailVerifiedAt) {
    throw new AuthError("FORBIDDEN", "Verify your email before purchasing.");
  }

  if (await isLifetimeUser(user.id)) {
    return NextResponse.json({ error: "You already have lifetime access." }, { status: 409 });
  }

  if (planKey === LIFETIME_PLAN_KEY) {
    if (!(await lifetimeGrantAvailable())) {
      return NextResponse.json({ error: "Lifetime access is not available." }, { status: 409 });
    }
  } else {
    const current = await db.subscription.findFirst({
      where: { userId: user.id, status: { in: ["active", "trialing", "past_due"] }, plan: { key: planKey } },
      select: { id: true },
    });
    if (current) {
      return NextResponse.json({ error: "You are already on this plan." }, { status: 409 });
    }
  }

  await enforceRateLimit({ key: `whop-checkout:${user.id}`, limit: 10, windowSeconds: 60 * 60 });

  let url: string;
  try {
    url = await createWhopCheckout({
      planKey: planKey as WhopPlanKey,
      userId: user.id,
      redirectUrl: `${appOrigin()}/settings/billing?checkout=success`,
    });
  } catch (e) {
    const status = e instanceof WhopApiError && e.status === 503 ? 503 : 502;
    return NextResponse.json({ error: "Could not start checkout with the billing provider. Please try again." }, { status });
  }

  await auditLog({ userId: user.id, action: "billing.checkout.created", metadata: { provider: "whop", planKey } });
  return ok({ url });
});
