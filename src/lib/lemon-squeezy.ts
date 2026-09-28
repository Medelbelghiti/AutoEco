/**
 * Lemon Squeezy adapter.
 *
 * Implements the small subset of the Lemon Squeezy API that the
 * application needs:
 *   - createCheckout()          — builds a checkout URL for a Variant
 *   - verifyWebhookSignature()  — HMAC-SHA256 over the raw body
 *   - getVariantIdFor(planKey)  — maps a plan key to the configured
 *                                 Variant ID from environment variables
 *
 * The application MUST NOT hard-code Variant IDs — they come from env.
 * The application MUST NOT call the Lemon Squeezy API before checking
 * `lemonSqueezyConfigured()`.
 *
 * The webhook signature follows Lemon Squeezy's documented scheme:
 *   hex(HMAC-SHA256(webhook_signing_secret, raw_request_body))
 * The signature is sent in the `X-Signature` header.
 *
 * For real-time production, set:
 *   LEMON_SQUEEZY_API_KEY
 *   LEMON_SQUEEZY_STORE_ID
 *   LEMON_SQUEEZY_PRO_VARIANT_ID
 *   LEMON_SQUEEZY_BUSINESS_VARIANT_ID
 *   LEMON_SQUEEZY_LIFETIME_VARIANT_ID
 *   LEMON_SQUEEZY_WEBHOOK_SECRET
 *
 * In development all of these can be empty; `lemonSqueezyConfigured()`
 * will return false and the application will fall back to Stripe.
 */
import crypto from "node:crypto";
import { env, lemonSqueezyWebhookConfigured, lemonSqueezyConfigured } from "./env";

export type PlanKey = "pro" | "business" | "pro_plus" | "lifetime";

/**
 * Map an internal Plan key to a Lemon Squeezy Variant ID from the
 * environment. Throws if the variant is not configured.
 */
export function getVariantIdFor(planKey: PlanKey): string {
  switch (planKey) {
    case "pro":
      if (!env.lemonSqueezyProVariantId) throw new Error("LEMON_SQUEEZY_PRO_VARIANT_ID is not configured");
      return env.lemonSqueezyProVariantId;
    case "business":
      if (!env.lemonSqueezyBusinessVariantId) throw new Error("LEMON_SQUEEZY_BUSINESS_VARIANT_ID is not configured");
      return env.lemonSqueezyBusinessVariantId;
    case "pro_plus":
      // The spec doesn't define a pro_plus variant on Lemon Squeezy; we
      // map it to the Business variant (highest paid tier) until a
      // dedicated variant is created. This keeps the existing plan
      // keys working without a destructive schema change.
      if (!env.lemonSqueezyBusinessVariantId) throw new Error("LEMON_SQUEEZY_BUSINESS_VARIANT_ID is not configured");
      return env.lemonSqueezyBusinessVariantId;
    case "lifetime":
      if (!env.lemonSqueezyLifetimeVariantId) throw new Error("LEMON_SQUEEZY_LIFETIME_VARIANT_ID is not configured");
      return env.lemonSqueezyLifetimeVariantId;
  }
}

export interface CheckoutInput {
  userId: string;
  email: string;
  planKey: PlanKey;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
}

/**
 * Build a Lemon Squeezy checkout URL.
 *
 * For a hosted checkout, Lemon Squeezy expects:
 *   https://<store>.lemonsqueezy.com/buy/<variant_id>?checkout[...]=...
 *
 * The API key is NOT embedded in the URL. The signature mechanism is
 * per-product; for the production-grade hosted checkout we use the
 * "buy" URL with embedded checkout data.
 */
export { lemonSqueezyConfigured } from "./env";

export function createCheckout(input: CheckoutInput): CheckoutResult {
  if (!lemonSqueezyConfigured()) {
    throw new Error("Lemon Squeezy is not configured");
  }
  const variantId = getVariantIdFor(input.planKey);
  const storeId = env.lemonSqueezyStoreId;

  const params = new URLSearchParams();
  params.set("checkout[email]", input.email);
  params.set("checkout[custom][user_id]", input.userId);
  params.set("checkout[success_url]", input.successUrl);
  params.set("checkout[cancel_url]", input.cancelUrl);
  // disableModal=true forces a full-page redirect (server-side flow).
  params.set("disable_modal", "true");

  const url = `https://${storeId}.lemonsqueezy.com/buy/${variantId}?${params.toString()}`;
  return { url };
}

/**
 * Verify a Lemon Squeezy webhook signature.
 *
 * The signature is `hex(HMAC-SHA256(signing_secret, raw_body))`,
 * sent in the `X-Signature` header.
 *
 * Uses `crypto.timingSafeEqual` to prevent timing attacks.
 * Returns false if the secret is not configured, the header is missing,
 * or the signature does not match.
 *
 * `secretOverride` is intended for tests; production callers should omit
 * it. The env value is read at call time, not at module load, so a
 * test that mutates `process.env` between calls is supported.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretOverride?: string
): boolean {
  const secret = secretOverride ?? env.lemonSqueezyWebhookSecret;
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHeader, "hex"));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*                       Webhook event mapping                          */
/* ------------------------------------------------------------------ */

/**
 * The set of Lemon Squeezy event names this application handles. We
 * deliberately do NOT use the full Lemon Squeezy taxonomy; we only
 * support the events required to keep the application in sync with the
 * user's entitlement.
 *
 *   order_created    — first successful purchase
 *   subscription_created
 *   subscription_updated
 *   subscription_cancelled
 *   subscription_resumed
 *   subscription_expired
 *   order_refunded
 */
export type LemonEventName =
  | "order_created"
  | "subscription_created"
  | "subscription_updated"
  | "subscription_cancelled"
  | "subscription_resumed"
  | "subscription_expired"
  | "order_refunded";

export interface LemonWebhookPayload {
  meta: {
    event_name: LemonEventName;
    custom_data?: { user_id?: string };
  };
  data: {
    type: "orders" | "subscriptions";
    id: string;
    attributes: {
      customer_id?: string;
      customer_email?: string;
      status?: string;
      // subscriptions
      user_email?: string;
      // orders
      user_name?: string;
      // generic
      [key: string]: unknown;
    };
  };
}
