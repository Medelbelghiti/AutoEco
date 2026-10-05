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

/**
 * Plan keys that actually exist as `Plan.key` rows in the database
 * (see `prisma/seed.ts`): free | pro | family | pro_plus.
 *
 * `business` and `lifetime` are retained as DEPRECATED ALIASES only.
 * They were never seeded, so resolving them to themselves silently granted
 * nobody an entitlement. They now resolve to the real plan they were
 * always meant to mean.
 */
export type PaddlePlanKey = "pro" | "family" | "pro_plus";
export type PaddlePlanKeyOrAlias = PaddlePlanKey | "business" | "lifetime";

/** Every paid plan key, in display order. */
export const PADDLE_PLAN_KEYS: PaddlePlanKey[] = ["pro", "family", "pro_plus"];

/** Type guard: does this database `Plan.key` map to a Paddle price? */
export function isPaddlePlanKey(k: string): k is PaddlePlanKey {
  return (PADDLE_PLAN_KEYS as string[]).includes(k);
}

/** Canonical plan key for a possibly-legacy plan key. */
export function canonicalPlanKey(k: PaddlePlanKeyOrAlias): PaddlePlanKey {
  // Paddle has no separate "business" product — `PADDLE_BUSINESS_PRICE_ID`
  // is the price id for the highest paid tier, which is `pro_plus`.
  if (k === "business") return "pro_plus";
  if (k === "lifetime") return "pro_plus";
  return k;
}

/**
 * Map an internal Plan key to a Paddle price id from the environment.
 * Throws if the price id is not configured.
 */
export function getPriceIdFor(planKey: PaddlePlanKeyOrAlias): string {
  switch (canonicalPlanKey(planKey)) {
    case "pro":
      if (!env.paddleProPriceId) throw new Error("PADDLE_PRO_PRICE_ID is not configured");
      return env.paddleProPriceId;
    case "family":
      if (!env.paddleFamilyPriceId) throw new Error("PADDLE_FAMILY_PRICE_ID is not configured");
      return env.paddleFamilyPriceId;
    case "pro_plus":
      if (!env.paddleBusinessPriceId) throw new Error("PADDLE_BUSINESS_PRICE_ID is not configured");
      return env.paddleBusinessPriceId;
  }
}

/**
 * Resolve a Paddle price id back to an internal plan key.
 * Returns `null` when the price id belongs to another product in the
 * Paddle catalog, so callers can log it instead of guessing.
 */
export function planKeyForPriceId(priceId: string | undefined): PaddlePlanKey | null {
  if (!priceId) return null;
  if (env.paddleProPriceId && priceId === env.paddleProPriceId) return "pro";
  if (env.paddleFamilyPriceId && priceId === env.paddleFamilyPriceId) return "family";
  if (env.paddleBusinessPriceId && priceId === env.paddleBusinessPriceId) return "pro_plus";
  // A lifetime price is a one-off payment for the top tier.
  if (env.paddleLifetimePriceId && priceId === env.paddleLifetimePriceId) return "pro_plus";
  return null;
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
  | "subscription.past_due"
  | "subscription.payment_failed"
  | "transaction.completed"
  | "transaction.payment_failed"
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
    /**
     * Present on subscription + transaction payloads when the checkout was
     * opened with `custom_data`. This is how a BRAND NEW Paddle customer is
     * matched to an AutoEco account — `customer_id` is not persisted
     * anywhere before the first webhook arrives.
     */
    custom_data?: {
      userId?: string;
      planKey?: string;
      email?: string;
    };
    /** Next scheduled billing date (ISO 8601). */
    next_billed_at?: string | null;
    /** Current billing window (ISO 8601). */
    current_billing_period?: { starts_at?: string; ends_at?: string } | null;
    /** Set when the customer has scheduled a cancellation. */
    scheduled_change?: string | null;
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

/**
 * Paddle Billing sends every amount as a STRING in the currency's lowest
 * denomination ("699" = $6.99). It is already "cents": never multiply by 100.
 */
export function paddleAmountToCents(raw: unknown): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Keep the real ISO 4217 code Paddle charged; fall back to USD only for garbage. */
export function normalizeInvoiceCurrency(raw: unknown): string {
  const c = String(raw ?? "USD").toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "USD";
}
