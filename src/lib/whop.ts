/**
 * Whop adapter — server side only.
 *
 * Whop is the payment provider (it replaced Paddle and PayPal in 2.5). It
 * sells the two recurring plans (`pro`, `pro_plus`) and the one-time
 * "Founder Lifetime" plan (`lifetime`).
 *
 * Flow:
 *   1. `POST /api/billing/checkout` creates a Whop checkout configuration for
 *      the plan's Whop plan id, with `metadata.userId` + `metadata.planKey`,
 *      and redirects the browser to its hosted `purchase_url`.
 *   2. Whop copies that metadata onto the resulting membership and payments.
 *   3. `POST /api/whop/webhook` (signed, Standard Webhooks) is the only thing
 *      that grants or revokes entitlement.
 *
 * Every value is read LIVE from `process.env` (not a module-load snapshot) so
 * the feature can be switched off at runtime and tests can set variables per
 * case. Nothing here is ever logged, and nothing here is sent to the browser.
 */
import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/*                           Configuration                             */
/* ------------------------------------------------------------------ */

export type WhopEnvironment = "sandbox" | "live";

/** Sandbox unless `WHOP_ENV=live` is set explicitly: an unset value never moves real money. */
export function whopEnvironment(): WhopEnvironment {
  return process.env.WHOP_ENV === "live" ? "live" : "sandbox";
}

/** REST base URL for the configured environment. */
export function whopApiBase(): string {
  return whopEnvironment() === "live" ? "https://api.whop.com/api/v1" : "https://sandbox-api.whop.com/api/v1";
}

/** SECRET. Company API key from Whop → Developer. */
export function whopApiKey(): string {
  return (process.env.WHOP_API_KEY ?? "").trim();
}

/** SECRET. The webhook signing secret (`ws_...`), used verbatim as the HMAC key. */
export function whopWebhookSecret(): string {
  return (process.env.WHOP_WEBHOOK_SECRET ?? "").trim();
}

/** Whop company / account id (`biz_...`). */
export function whopCompanyId(): string {
  return (process.env.WHOP_COMPANY_ID ?? "").trim();
}

/** Internal plan keys that Whop sells. Must match `Plan.key` rows in the database. */
export type WhopPlanKey = "pro" | "pro_plus" | "lifetime";
export const WHOP_PLAN_KEYS: WhopPlanKey[] = ["pro", "pro_plus", "lifetime"];
export const LIFETIME_PLAN_KEY = "lifetime" as const;

export function isWhopPlanKey(k: string): k is WhopPlanKey {
  return (WHOP_PLAN_KEYS as string[]).includes(k);
}

const PLAN_ENV: Record<WhopPlanKey, string> = {
  pro: "WHOP_PRO_PLAN_ID",
  pro_plus: "WHOP_PRO_PLUS_PLAN_ID",
  lifetime: "WHOP_LIFETIME_PLAN_ID",
};

/** The Whop plan id (`plan_...`) for an internal plan key, or "" when not configured. */
export function whopPlanIdFor(planKey: WhopPlanKey): string {
  return (process.env[PLAN_ENV[planKey]] ?? "").trim();
}

/**
 * Resolve a Whop plan id back to an internal plan key. Returns null for a plan
 * that belongs to another product in the Whop catalogue, so callers can audit
 * it instead of guessing (an unmapped plan must never grant anything).
 */
export function planKeyForWhopPlanId(planId: string | null | undefined): WhopPlanKey | null {
  if (!planId) return null;
  for (const k of WHOP_PLAN_KEYS) {
    const id = whopPlanIdFor(k);
    if (id && id === planId) return k;
  }
  return null;
}

/** The webhook can verify deliveries. */
export function whopWebhookConfigured(): boolean {
  return whopWebhookSecret() !== "";
}

/**
 * The single gate every checkout surface checks: API key, webhook secret,
 * company id and at least one plan id. Anything missing => no checkout is
 * offered anywhere (fail closed).
 */
export function whopConfigured(): boolean {
  return (
    whopApiKey() !== "" &&
    whopWebhookConfigured() &&
    whopCompanyId() !== "" &&
    WHOP_PLAN_KEYS.some((k) => whopPlanIdFor(k) !== "")
  );
}

/** A specific plan can be bought right now. */
export function whopPlanPurchasable(planKey: string): boolean {
  return whopConfigured() && isWhopPlanKey(planKey) && whopPlanIdFor(planKey) !== "";
}

/**
 * Maximum number of Founder Lifetime grants. 0 (the default) means the
 * lifetime offer is off. Also set the same stock on the Whop plan so Whop
 * itself stops selling at the cap.
 */
export function lifetimeMaxGrants(): number {
  const n = Number(process.env.LIFETIME_MAX_GRANTS ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/* ------------------------------------------------------------------ */
/*                       Webhook signature                              */
/* ------------------------------------------------------------------ */

/**
 * Verify a Whop webhook (Standard Webhooks scheme).
 *
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(key, signed content))
 *   header         = `webhook-signature: v1,<sig> [v1,<sig2> ...]`
 *
 * The one Whop-specific detail: the HMAC key is the LITERAL bytes of the
 * `ws_...` secret, prefix included. Generic Standard Webhooks libraries
 * base64-decode the secret first and therefore fail on every delivery
 * (this mirrors `unwrapWebhook` in `@whop/sdk/helpers`).
 *
 * Replays outside `toleranceSeconds` are refused. Retries reuse the same
 * `webhook-id` and are de-duplicated by the `WebhookEvent` claim.
 */
export function verifyWhopSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secretOverride?: string,
  toleranceSeconds = 300,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  const secret = secretOverride ?? whopWebhookSecret();
  if (!secret) return false;
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (Math.abs(nowSec - ts) > toleranceSeconds) return false;

  const expected = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0) continue;
    if (entry.slice(0, comma) !== "v1") continue;
    let received: Buffer;
    try {
      received = Buffer.from(entry.slice(comma + 1), "base64");
    } catch {
      continue;
    }
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) return true;
  }
  return false;
}

/** Produce a valid signature header. Test/tooling helper — production never signs. */
export function signWhopPayload(rawBody: string, id: string, timestamp: string, secret: string): string {
  const sig = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return `v1,${sig}`;
}

/* ------------------------------------------------------------------ */
/*                           Payload shapes                             */
/* ------------------------------------------------------------------ */

/**
 * Whop renamed a few fields across dated API versions (`plan` → `variant`,
 * nested `user` objects → `user_id`, `company_id` → `account_id`). The
 * helpers below read every shape seen in the docs so a webhook pinned to an
 * older or newer `api_version_date` still resolves the same values.
 */
export type WhopMoney = { amount?: string | number; currency?: string; decimals?: number } | number | string | null | undefined;

export interface WhopWebhookEnvelope {
  id?: string;
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function idOf(v: unknown): string | null {
  return str(v) ?? str(asObj(v)?.id);
}

/** `metadata` from the checkout configuration, copied by Whop onto memberships and payments. */
export function readMetadata(data: Obj | undefined): { userId: string | null; planKey: string | null } {
  const m = asObj(data?.metadata);
  return { userId: str(m?.userId), planKey: str(m?.planKey) };
}

/** The Whop plan id (`plan_...`) of a membership or payment, across API versions. */
export function readPlanId(data: Obj | undefined): string | null {
  if (!data) return null;
  return str(data.variant_id) ?? str(data.plan_id) ?? idOf(data.variant) ?? idOf(data.plan);
}

export function readUserId(data: Obj | undefined): string | null {
  if (!data) return null;
  return str(data.user_id) ?? idOf(data.user);
}

/** Membership id: the object id for membership events, `membership_id` on payments. */
export function readMembershipId(data: Obj | undefined, isMembershipEvent: boolean): string | null {
  if (!data) return null;
  if (isMembershipEvent) return str(data.id);
  return str(data.membership_id) ?? idOf(data.membership);
}

/** Parse an ISO 8601 timestamp (or unix seconds, used by some legacy payloads). */
export function parseWhopDate(raw: unknown): Date | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(raw < 1e12 ? raw * 1000 : raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw !== "string" || raw === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a Whop amount to minor units. Current API versions send
 * `{ amount: "6.99", decimals: 2, currency: "usd" }` (major units, exact
 * decimal string); older ones send a bare number in major units (6.99).
 * Parsed as a string so no float rounding can creep in. Returns null when the
 * value is missing or malformed so callers can refuse to record a wrong amount.
 */
export function whopMoneyToMinor(raw: WhopMoney, fallbackDecimals = 2): number | null {
  let amount: string;
  let decimals = fallbackDecimals;
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    amount = raw.toFixed(decimals);
  } else if (typeof raw === "string") {
    amount = raw.trim();
  } else {
    if (raw.amount == null) return null;
    amount = typeof raw.amount === "number" ? raw.amount.toFixed(raw.decimals ?? decimals) : String(raw.amount).trim();
    if (typeof raw.decimals === "number" && Number.isInteger(raw.decimals) && raw.decimals >= 0 && raw.decimals <= 4) {
      decimals = raw.decimals;
    }
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  // Truncating extra precision would silently under-record; refuse instead.
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return null;
  const minor = Number(m[1]) * 10 ** decimals + Number(frac.slice(0, decimals) || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** ISO 4217 code, upper-cased, from a Money object or a sibling `currency` field. */
export function readCurrency(...candidates: unknown[]): string {
  for (const c of candidates) {
    const v = typeof c === "string" ? c : str(asObj(c)?.currency);
    if (v && /^[a-zA-Z]{3}$/.test(v)) return v.toUpperCase();
  }
  return "USD";
}

/* ------------------------------------------------------------------ */
/*                       Membership status mapping                      */
/* ------------------------------------------------------------------ */

/**
 * Whop membership statuses → our `Subscription.status`.
 *
 *   trialing            → trialing
 *   active              → active
 *   canceling           → active (+ cancelAtPeriodEnd): access until period end
 *   past_due/unresolved → past_due (bounded grace in `getEntitlements`)
 *   canceled/expired    → canceled
 *   completed           → canceled for a recurring plan (it ended);
 *                         lifetime for a one-time plan (paid in full)
 *   drafted / unknown   → null (ignore: never grants, never revokes)
 */
export function mapMembershipStatus(
  whopStatus: string | null,
  isLifetimePlan: boolean
): { status: string; cancelAtPeriodEnd: boolean } | null {
  const s = (whopStatus ?? "").toLowerCase();
  if (isLifetimePlan) {
    if (s === "active" || s === "completed" || s === "trialing") return { status: "lifetime", cancelAtPeriodEnd: false };
    if (s === "canceled" || s === "expired") return { status: "canceled", cancelAtPeriodEnd: false };
    return null;
  }
  switch (s) {
    case "trialing":
      return { status: "trialing", cancelAtPeriodEnd: false };
    case "active":
      return { status: "active", cancelAtPeriodEnd: false };
    case "canceling":
      return { status: "active", cancelAtPeriodEnd: true };
    case "past_due":
    case "unresolved":
      return { status: "past_due", cancelAtPeriodEnd: false };
    case "canceled":
    case "expired":
    case "completed":
      return { status: "canceled", cancelAtPeriodEnd: false };
    default:
      return null;
  }
}

/** Subscription statuses that grant paid access (see `getEntitlements`). */
export const ACCESS_STATUSES = ["active", "trialing", "past_due", "lifetime"] as const;
