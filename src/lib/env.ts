/** Centralized environment access. Never import this from client components. */

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  authSecret: process.env.AUTH_SECRET ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

  // ---- Paddle (production payment provider) ----
  // The API key + webhook secret are server-only.
  paddleApiKey: process.env.PADDLE_API_KEY ?? "",
  paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? "",
  paddleSellerId: process.env.PADDLE_SELLER_ID ?? "",
  paddleProPriceId: process.env.PADDLE_PRO_PRICE_ID ?? "",
  paddleFamilyPriceId: process.env.PADDLE_FAMILY_PRICE_ID ?? "",
  paddleBusinessPriceId: process.env.PADDLE_BUSINESS_PRICE_ID ?? "",
  paddleLifetimePriceId: process.env.PADDLE_LIFETIME_PRICE_ID ?? "",
  // The Paddle.js client-side token (browser). NEXT_PUBLIC_ so it ends up
  // in the client bundle; do NOT put the API key here.
  paddleClientToken: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "",

  emailProvider: process.env.EMAIL_PROVIDER ?? "console",
  emailFrom: process.env.EMAIL_FROM ?? "AutoEco <no-reply@example.com>",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",

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
 * Paddle is configured when the API key, webhook secret, seller id, and
 * at least one price id are all present. The client token is checked
 * separately because it lives on the browser side.
 */
export function paddleConfigured(): boolean {
  return Boolean(
    env.paddleApiKey &&
      env.paddleWebhookSecret &&
      env.paddleSellerId &&
      (env.paddleProPriceId || env.paddleFamilyPriceId || env.paddleBusinessPriceId || env.paddleLifetimePriceId)
  );
}

export function paddleWebhookConfigured(): boolean {
  return Boolean(env.paddleWebhookSecret);
}

/**
 * Live-mode detection. Paddle live keys start with `pdl_live_apikey_`,
 * sandbox keys start with `pdl_sdbx_apikey_` (newer) or `pdl_test_apikey_`
 * (older). We only treat live keys as live.
 */
export function paddleIsLive(): boolean {
  return env.paddleApiKey.includes("pdl_live_apikey_");
}

/**
 * Default Paddle environment for Paddle.js.
 *
 * Default = "sandbox" (safe). Set PADDLE_ENV=live in Vercel ONLY when
 * you are ready to charge real money. The check is double-guarded: the
 * runtime PaddleButton will also re-check via NEXT_PUBLIC_PADDLE_ENV and
 * refuse to open a real-mode checkout unless explicitly configured.
 */
export function paddleEnvironment(): "sandbox" | "live" {
  return process.env.PADDLE_ENV === "live" ? "live" : "sandbox";
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
  if (paddleConfigured() && env.paddleClientToken === "") {
    w.push(
      "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is empty — the Paddle.js checkout cannot open in the browser even though the server is configured."
    );
  }
  if (paddleEnvironment() === "sandbox" && paddleConfigured()) {
    w.push(
      "PADDLE_ENV is not \"live\" — checkouts run against Paddle sandbox and no real money is charged."
    );
  }
  if (!env.captchaProvider) {
    w.push(
      "CAPTCHA_PROVIDER is not configured — signup/login are protected only by IP rate limiting."
    );
  }
  return w;
}

/**
 * Production safety audit. Returns a list of problems.
 * Empty array means production deployment is safe.
 *
 * These are HARD failures (missing/weak secrets) — unlike `prodWarnings()`.
 */
export function assertProdSafety(): string[] {
  const problems: string[] = [];
  if (env.isProd) {
    if (!env.authSecret || env.authSecret.length < 32) {
      problems.push(
        "AUTH_SECRET must be set to a strong random value (32+ bytes) in production"
      );
    }
    if (env.paddleApiKey && !env.paddleApiKey.startsWith("pdl_sdbx_") && env.paddleWebhookSecret.length < 16) {
      problems.push("PADDLE_WEBHOOK_SECRET appears too short");
    }
    if (env.paddleApiKey && env.paddleApiKey.startsWith("pdl_sdbx_") && env.isProd) {
      problems.push("A Paddle SANDBOX API key is configured in production");
    }
  }
  return problems;
}

/**
 * Throws on boot in production if required secrets are missing.
 * Safe to call from `instrumentation.ts` or any module-level init.
 *
 * Soft misconfigurations (email, Paddle sandbox mode, CAPTCHA) are logged
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
