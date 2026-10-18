/**
 * PayPal one-time "Founder Lifetime" configuration — server side only.
 *
 * Every value is read LIVE from `process.env` rather than from the
 * module-load snapshot in `env.ts`. Two reasons:
 *
 *   1. Fail-closed toggling. The feature must be disableable — and testable
 *      as disabled — at runtime (`BILLING_ENABLED`), and a missing credential
 *      must turn the whole feature OFF, not crash a page that imports this
 *      module.
 *   2. Tests set the PayPal variables per case; a snapshot at import time
 *      would freeze the first value seen.
 *
 * NOTHING here is secret-bearing beyond reading a secret into a local
 * variable. No `process.env` value is ever logged, and the client id is the
 * only value ever handed to the browser.
 */

export type PaypalEnvironment = "sandbox" | "live";

/** The single feature flag. Default false: nothing bills unless explicitly on. */
export function paypalBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

/**
 * Sandbox by default. `live` requires an explicit `PAYPAL_ENV=live`; the API
 * base URL is derived from this, so an unset value can never contact live.
 */
export function paypalEnvironment(): PaypalEnvironment {
  return process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
}

export function paypalClientId(): string {
  return process.env.PAYPAL_CLIENT_ID ?? "";
}

/** SECRET. Never log, never send to the browser, never put in a response. */
export function paypalClientSecret(): string {
  return process.env.PAYPAL_CLIENT_SECRET ?? "";
}

export function paypalWebhookId(): string {
  return process.env.PAYPAL_WEBHOOK_ID ?? "";
}

/**
 * The one-time price in minor units (9900 => USD 99.00). A missing, zero or
 * malformed value returns 0, which disables checkout (there is no "free"
 * lifetime grant).
 */
export function lifetimePriceMinor(): number {
  const n = Number(process.env.LIFETIME_PRICE_MINOR ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** ISO 4217 code, upper-cased. Anything that is not three letters returns "". */
export function lifetimeCurrency(): string {
  const c = (process.env.LIFETIME_CURRENCY ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "";
}

/**
 * Maximum number of lifetime grants. 0 (the code default) means "no grants
 * available", i.e. the feature is off even if `BILLING_ENABLED` is true. The
 * owner's configured cap is supplied through the environment.
 */
export function lifetimeMaxGrants(): number {
  const n = Number(process.env.LIFETIME_MAX_GRANTS ?? "");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The PayPal REST API base for the configured environment. */
export function paypalApiBase(): string {
  return paypalEnvironment() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

/**
 * True only when billing is enabled AND every PayPal credential is present AND
 * a price and currency are configured. Any missing piece => false => no
 * endpoint creates an order and no button renders. This is the single gate
 * every route and every server-rendered card checks.
 */
export function paypalConfigured(): boolean {
  return (
    paypalBillingEnabled() &&
    paypalClientId() !== "" &&
    paypalClientSecret() !== "" &&
    paypalWebhookId() !== "" &&
    lifetimePriceMinor() > 0 &&
    lifetimeCurrency() !== ""
  );
}

/**
 * The public PayPal JS SDK client id, or "" when the feature is not fully
 * configured. Returned only to server components, which pass it to the browser
 * component; it is never derived from a `NEXT_PUBLIC_` variable so a sandbox
 * id can never leak into a build by accident.
 */
export function paypalSdkClientId(): string {
  return paypalConfigured() ? paypalClientId() : "";
}

/**
 * Convert a PayPal amount (a decimal string such as "99.00", or a number) into
 * minor units. Returns null when the value cannot be parsed, so callers can
 * refuse to record a malformed amount rather than store a wrong one.
 */
export function paypalAmountToMinor(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
