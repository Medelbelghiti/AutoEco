import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCheckout, lemonSqueezyConfigured } from "@/lib/lemon-squeezy";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/analytics";

const Schema = z.object({ planKey: z.enum(["pro", "business", "pro_plus", "lifetime"]) });

/**
 * POST /api/lemonsqueezy/checkout
 *
 * Creates a Lemon Squeezy hosted-checkout URL for the requested plan
 * and returns it to the client (which then does a top-level
 * navigation, not an iframe).
 *
 * The server-side business rule that decides which plans a user can
 * upgrade to is unchanged from the existing application logic — this
 * endpoint only builds the URL.
 */
export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, Schema);

  if (!lemonSqueezyConfigured()) {
    return NextResponse.json(
      { error: "Lemon Squeezy is not configured on this server. Set LEMON_SQUEEZY_API_KEY, LEMON_SQUEEZY_STORE_ID, and the variant IDs in your environment." },
      { status: 503 }
    );
  }

  await trackEvent("checkout_started", { userId: user.id, metadata: { planKey: body.planKey, provider: "lemonsqueezy" } });

  try {
    const { url } = createCheckout({
      userId: user.id,
      email: user.email,
      planKey: body.planKey,
      successUrl: `${env.appUrl}/dashboard?upgraded=1`,
      cancelUrl: `${env.appUrl}/pricing`,
    });
    return ok({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
});
