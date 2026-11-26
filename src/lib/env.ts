/** Centralized environment access. Never import this from client components. */
import { appOrigin } from "./seo";
import { whopConfigured, whopEnvironment } from "./whop";

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  authSecret: process.env.AUTH_SECRET ?? "",
  // Canonical origin, resolved by the one shared helper (`src/lib/seo.ts`) so
  // SEO and every emailed link can never diverge. Both NEXT_PUBLIC_APP_URL and
  // NEXT_PUBLIC_SITE_URL must be set to the same canonical host.
  appUrl: appOrigin(),

  // Payments (Whop) are configured in `src/lib/whop.ts`, which reads its
  // variables live so billing can be switched off without a redeploy.

  emailProvider: process.env.EMAIL_PROVIDER ?? "console",
  emailFrom: process.env.EMAIL_FROM ?? "AutoEco <no-reply@example.com>",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",

  // ---- Error monitoring (optional) ----
  // Leave SENTRY_DSN empty to keep error reporting local-only. The adapter is
  // inert unless a DSN is present.
  sentryDsn: process.env.SENTRY_DSN ?? "",
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? "",
  sentryRelease: process.env.SENTRY_RELEASE ?? "",

  // ---- Object storage (uploads: receipts, documents) ----
  // STORAGE_DRIVER forces "local" or "s3". Left empty, the driver is inferred:
  // s3 when a bucket and credentials are present, local otherwise.
  storageDriver: process.env.STORAGE_DRIVER ?? "",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "auto",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",

  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  osmNominatimUrl: process.env.OSM_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  osmOverpassUrl: process.env.OSM_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",

  aiEnrichmentEnabled: process.env.AI_ENRICHMENT_ENABLED === "true",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",

  captchaProvider: process.env.CAPTCHA_PROVIDER ?? "",
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",

  isProd: process.env.NODE_ENV === "production",
};

/**
 * Shared secret protecting the detailed /api/health report. Sent by monitors
 * as `Authorization: Bearer <HEALTH_SECRET>`; a request without it gets only
 * `{ ok: boolean }`.
 *
 * Read LIVE from `process.env` so an operator can rotate — or remove it to
 * disable the detailed view — without a restart. It is never logged, never
 * placed in a response, and compared in constant time by the route.
 */
export function healthSecret(): string {
  return process.env.HEALTH_SECRET ?? "";
}

/**
 * Email is considered configured only when a real transport is selected AND
 * reachable. Anything else silently degrades to ConsoleProvider, which
 * "sends" by writing to the server log — meaning verification and password
 * reset emails reach nobody while the UI reports success.
 */
export function emailConfigured(): boolean {
  return env.emailProvider === "smtp" && Boolean(env.smtpHost);
}

/**
 * Optional Reply-To address applied to every outgoing message. Read LIVE from
 * `process.env` so an operator can set or clear it without a restart. An empty
 * value means the Reply-To header is omitted entirely.
 */
export function emailReplyTo(): string | undefined {
  const value = (process.env.EMAIL_REPLY_TO ?? "").trim();
  return value || undefined;
}

/**
 * Soft production misconfigurations. These must NOT crash the app — a
 * missing SMTP host should degrade visibility, not take the whole site
 * down — but they are surfaced on /api/health, the admin dashboard and the
 * boot log so they cannot go unnoticed.
 */
export function prodWarnings(): string[] {
  const w: string[] = [];
  if (!env.isProd) return w;

  if (!emailConfigured()) {
    w.push(
      `EMAIL_PROVIDER="${env.emailProvider}" with SMTP_HOST="${env.smtpHost ? "set" : "empty"}" — ` +
        "transactional email (verification, password reset, billing) will NOT be delivered. " +
        "Set EMAIL_PROVIDER=smtp and SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS."
    );
  }
  if (/@example\.com/i.test(env.emailFrom)) {
    w.push(
      `EMAIL_FROM="${env.emailFrom}" still points at example.com — transactional email will be rejected or undeliverable.`
    );
  }
  if (whopConfigured() && whopEnvironment() === "sandbox") {
    w.push(
      "WHOP_ENV is not \"live\" — checkouts run against the Whop sandbox and no real money is charged."
    );
  }
  if (!env.captchaProvider) {
    w.push(
      "CAPTCHA_PROVIDER is not configured — signup/login are protected only by IP rate limiting."
    );
  }
  // Read live rather than through `env`: CRON_SECRET is compared against a
  // minimum length in `lib/cron.ts`, and this keeps the two in step without
  // importing the (server-only) cron module here.
  if ((process.env.CRON_SECRET ?? "").length < 16) {
    w.push(
      "CRON_SECRET is unset or shorter than 16 characters — every /api/cron/* route returns 503, so subscription expiry, trial-ending email and account purges will not run."
    );
  }
  // No payment provider at all: visitors can browse the pricing page but
  // cannot buy anything. This is the "nothing is for sale" state and is the
  // single most expensive misconfiguration to miss.
  if (!whopConfigured()) {
    w.push(
      "No payment provider is active: Whop is not configured (WHOP_API_KEY, WHOP_WEBHOOK_SECRET, WHOP_COMPANY_ID and a WHOP_*_PLAN_ID). The pricing page shows no checkout — visitors cannot subscribe or buy."
    );
  }
  if (!env.sentryDsn) {
    w.push(
      "SENTRY_DSN is unset — production errors stay in the platform log only (no alerting, no grouping, no source-mapped stack traces)."
    );
  }
  return w;
}

/**
 * Production safety audit. Returns a list of problems.
 * Empty array means production deployment is safe.
 *
 * Reads secrets LIVE from `process.env` (not the module-load snapshot in
 * `env`) so the check always reflects what this process actually holds, even
 * when a secret was injected after `env.ts` was first imported — which is
 * exactly the window a missing AUTH_SECRET tends to slip through.
 *
 * These are HARD failures (missing/weak secrets) — unlike `prodWarnings()`.
 */
export function assertProdSafety(): string[] {
  const problems: string[] = [];
  if (process.env.NODE_ENV !== "production") return problems;

  const authSecret = process.env.AUTH_SECRET ?? "";
  if (!authSecret || authSecret.length < 32) {
    problems.push("AUTH_SECRET must be set to a strong random value (32+ bytes) in production");
  }
  const whopSecret = (process.env.WHOP_WEBHOOK_SECRET ?? "").trim();
  if (whopSecret && whopSecret.length < 16) {
    problems.push("WHOP_WEBHOOK_SECRET appears too short");
  }
  return problems;
}

/**
 * Throws on boot in production if required secrets are missing.
 * Safe to call from `instrumentation.ts` or any module-level init.
 *
 * Soft misconfigurations (email, Whop sandbox mode, CAPTCHA) are logged
 * via `prodWarnings()` but never throw — they must not take the site down.
 */
let _asserted = false;
export function assertProdOnBoot(): void {
  if (_asserted) return;
  _asserted = true;

  const warnings = prodWarnings();
  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn("[AutoEco] Production configuration warnings:\n  - " + warnings.join("\n  - "));
  }

  const problems = assertProdSafety();
  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[AutoEco] Production safety audit FAILED:\n  - " + problems.join("\n  - "));
    throw new Error("Refusing to start in production: " + problems.join("; "));
  }
}
