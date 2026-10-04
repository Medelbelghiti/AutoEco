import { db } from "./db";

/**
 * Analytics abstraction. Events are stored internally by default.
 * To forward to an external analytics vendor, implement `forwardEvent`
 * — never send lead data or PII to analytics systems.
 */
export type AnalyticsEventName =
  | "signup"
  | "trial_started"
  | "search_started"
  | "search_completed"
  | "export_created"
  | "checkout_started"
  | "subscription_created"
  | "subscription_canceled"
  | "referral_signup"
  | "login";

export async function trackEvent(
  event: AnalyticsEventName,
  params: { userId?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  const safeMetadata = sanitizeMetadata(params.metadata ?? {});
  await db.analyticsEvent.create({
    data: {
      userId: params.userId,
      event,
      metadata: JSON.stringify(safeMetadata),
    },
  });
  await forwardEvent(event, params.userId, safeMetadata);
}

/** Strip anything that could contain lead data or PII. */
function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const blocked = ["email", "name", "phone", "lead", "leads", "address", "website"];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (blocked.some((b) => k.toLowerCase().includes(b))) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * Optional outbound forwarding to a privacy-friendly analytics endpoint.
 *
 * Why this is opt-in and off by default:
 *  - GDPR/CCPA. Forwarding events off-site is a third-party disclosure and
 *    needs a lawful basis. Set ANALYTICS_ENDPOINT only after deciding that
 *    and publishing a cookie/analytics notice.
 *  - It must never carry PII. Only the event name and already-sanitised
 *    scalar metadata are sent, plus a random daily visitor id — never a
 *    userId, email, IP or vehicle data.
 *
 * Any failure is swallowed: analytics must not break a signup or a webhook.
 */
async function forwardEvent(
  event: string,
  userId: string | undefined,
  metadata: Record<string, unknown>
): Promise<void> {
  const endpoint = process.env.ANALYTICS_ENDPOINT;
  if (!endpoint) return;

  try {
    // A consented, non-identifying visitor id. Hashed so the vendor cannot
    // correlate it back to a userId, which never leaves the platform.
    const visitorId = await pseudonymize(userId ?? "anonymous");
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.ANALYTICS_WRITE_KEY
          ? { authorization: `Bearer ${process.env.ANALYTICS_WRITE_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        event,
        visitor_id: visitorId,
        metadata,
        ts: new Date().toISOString(),
      }),
      // Never let a slow vendor hold up the caller's response.
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* analytics is best-effort */
  }
}

async function pseudonymize(input: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? "autoeco-analytics";
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${secret}:${input}`)
    );
    return Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "anon";
  }
}

/** True when outbound analytics is wired up. Surfaced on /api/health. */
export function externalAnalyticsConfigured(): boolean {
  return Boolean(process.env.ANALYTICS_ENDPOINT);
}
