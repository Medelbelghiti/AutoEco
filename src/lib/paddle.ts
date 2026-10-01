/**
 * Paddle adapter — server side only.
 *
 * Implements:
 *   - verifyWebhookSignature()  — HMAC-SHA256 over the raw body
 *   - getPriceIdFor(planKey)     — maps internal plan key → Paddle price id
 *
 * The Paddle webhook signature scheme:
 *   - The signature is sent in the `Paddle-Signature` header.
 *   - Format: `ts=...;h1=...` (and older formats with `h1` only).
 *   - h1 = hex(HMAC-SHA256(webhook_secret, ts + "." + raw_body))
 *   - Verification: timestamp tolerance check (default 5 minutes) +
 *     constant-time HMAC compare.
 *
 * The CLIENT-SIDE checkout uses `Paddle.js` (loaded in the browser); the
 * server does NOT need to construct checkout URLs. That means there is
 * no `createCheckout()` server-side function — the price id is read
 * client-side and opened via `Paddle.Checkout.open({ priceId })`.
 *
 * All Paddle env values are read from `process.env` only. NEVER hardcode
 * keys in source. NEVER log keys.
 */
import crypto from "node:crypto";
import { env, paddleWebhookConfigured } from "./env";

export type PaddlePlanKey = "pro" | "business" | "pro_plus" | "lifetime";

/**
 * Map an internal Plan key to a Paddle price id from the environment.
 * Throws if the price id is not configured.
 */
export function getPriceIdFor(planKey: PaddlePlanKey): string {
  switch (planKey) {
    case "pro":
      if (!env.paddleProPriceId) throw new Error("PADDLE_PRO_PRICE_ID is not configured");
      return env.paddleProPriceId;
    case "business":
      if (!env.paddleBusinessPriceId) throw new Error("PADDLE_BUSINESS_PRICE_ID is not configured");
      return env.paddleBusinessPriceId;
    case "pro_plus":
      // Paddle has no separate "pro_plus" product; map it to the
      // highest paid tier we have (business). The application-level plan
      // key "pro_plus" is preserved via Subscription.planId.
      if (!env.paddleBusinessPriceId) throw new Error("PADDLE_BUSINESS_PRICE_ID is not configured");
      return env.paddleBusinessPriceId;
    case "lifetime":
      if (!env.paddleLifetimePriceId) throw new Error("PADDLE_LIFETIME_PRICE_ID is not configured");
      return env.paddleLifetimePriceId;
  }
}

/**
 * Verify a Paddle webhook signature.
 *
 * Signature header format (Paddle Billflow):
 *   ts=1700000000;h1=<hex-sha256>
 *
 * Where h1 = hex(HMAC-SHA256(webhook_secret, ts + "." + raw_body))
 *
 * We:
 *   1. Parse ts and h1
 *   2. Reject if ts is missing, not numeric, or older than `toleranceSeconds`
 *   3. Recompute h1 from the timestamp and raw body
 *   4. Compare with constant-time HMAC
 *
 * `secretOverride` is intended for tests; production callers should
 * omit it.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretOverride?: string,
  toleranceSeconds = 300
): boolean {
  const secret = secretOverride ?? env.paddleWebhookSecret;
  if (!secret) return false;
  if (!signatureHeader) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.ts) > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.ts}.${rawBody}`)
    .digest("hex");
  if (expected.length !== parsed.h1.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parsed.h1, "hex"));
  } catch {
    return false;
  }
}

function parseSignatureHeader(header: string): { ts: number; h1: string } | null {
  // Format: ts=1700000000;h1=<hex>
  const parts = header.split(";").map((p) => p.trim()).filter(Boolean);
  let ts: number | null = null;
  let h1: string | null = null;
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k === "ts") ts = Number(v);
    else if (k === "h1") h1 = v;
  }
  if (ts == null || !Number.isFinite(ts) || !h1) return null;
  return { ts, h1 };
}

/* ------------------------------------------------------------------ */
/*                       Webhook event mapping                          */
/* ------------------------------------------------------------------ */

/**
 * The set of Paddle webhook event names this application handles.
 * Deliberately minimal — only events that affect entitlement or require
 *   durable side effects.
 */
export type PaddleEventName =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.canceled"
  | "subscription.expired"
  | "transaction.completed"
  | "transaction.refunded";

/**
 * Minimal Paddle webhook payload shape — only the fields we read.
 * The full payload has many more; we accept `unknown` on any field.
 */
export interface PaddleWebhookPayload {
  event_id?: string;
  event_type?: PaddleEventName | string;
  occurred_at?: string;
  data?: {
    id?: string;
    status?: string;
    customer_id?: string;
    subscription_id?: string;
    items?: Array<{
      price?: { id?: string };
      quantity?: number;
    }>;
    currency_code?: string;
    details?: {
      tax?: { amount?: number };
      totals?: {
        grand_total?: number;
        currency_code?: string;
      };
    };
  };
}
