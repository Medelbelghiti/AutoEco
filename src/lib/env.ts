/** Centralized environment access. Never import this from client components. */

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  authSecret: process.env.AUTH_SECRET ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

  stripeMode: process.env.STRIPE_MODE ?? "test",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",

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
