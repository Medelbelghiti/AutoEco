/** Centralized environment access. Never import this from client components. */

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  authSecret: process.env.AUTH_SECRET ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

  stripeMode: process.env.STRIPE_MODE ?? "test",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",

  // ---- Paddle (production payment provider) ----
  // The API key + webhook secret are server-only.
  paddleApiKey: process.env.PADDLE_API_KEY ?? "",
  paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? "",
  paddleSellerId: process.env.PADDLE_SELLER_ID ?? "",
  paddleProPriceId: process.env.PADDLE_PRO_PRICE_ID ?? "",
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

  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  osmNominatimUrl: process.env.OSM_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  osmOverpassUrl: process.env.OSM_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",

  aiEnrichmentEnabled: process.env.AI_ENRICHMENT_ENABLED === "true",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",

  captchaProvider: process.env.CAPTCHA_PROVIDER ?? "",
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",

  isProd: process.env.NODE_ENV === "production",
};

export function stripeConfigured(): boolean {
  return Boolean(env.stripeSecretKey);
}

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
      (env.paddleProPriceId || env.paddleBusinessPriceId || env.paddleLifetimePriceId)
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
 * Production safety audit. Returns a list of problems.
 * Empty array means production deployment is safe.
 */
export function assertProdSafety(): string[] {
  const problems: string[] = [];
  if (env.isProd) {
    if (!env.authSecret || env.authSecret.length < 32) {
      problems.push(
        "AUTH_SECRET must be set to a strong random value (32+ bytes) in production"
      );
    }
    if (env.stripeMode === "live" && env.stripeSecretKey.startsWith("sk_test")) {
      problems.push("STRIPE_MODE=live but a test Stripe key is configured");
    }
    if (env.stripeMode === "test" && env.stripeSecretKey.startsWith("sk_live")) {
      problems.push("STRIPE_MODE=test but a live Stripe key is configured");
    }
    if (env.stripeWebhookSecret && env.stripeSecretKey && env.stripeWebhookSecret.length < 16) {
      problems.push("STRIPE_WEBHOOK_SECRET appears too short");
    }
  }
  return problems;
}

/**
 * Throws on boot in production if required secrets are missing.
 * Safe to call from middleware or any module-level init.
 */
let _asserted = false;
export function assertProdOnBoot(): void {
  if (_asserted) return;
  _asserted = true;
  const problems = assertProdSafety();
  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[AutoEco] Production safety audit FAILED:\n  - " + problems.join("\n  - "));
    throw new Error("Refusing to start in production: " + problems.join("; "));
  }
}
