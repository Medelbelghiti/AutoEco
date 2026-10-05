/**
 * Paddle Billing REST client (server side only).
 *
 * Paddle.js in the browser can open a checkout, but it cannot cancel a
 * subscription or open the customer portal: both need the API key and so must
 * run here. Without these calls a Paddle customer had NO way to stop being
 * charged from inside the app (the previous cancel/portal/resume routes were
 * Paddle-only).
 *
 * Docs: https://developer.paddle.com/api-reference/overview
 */
import { env, paddleEnvironment } from "./env";

function baseUrl(): string {
  return paddleEnvironment() === "live" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

export class PaddleApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PaddleApiError";
    this.status = status;
  }
}

async function paddleRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!env.paddleApiKey) throw new PaddleApiError(503, "Paddle is not configured");
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.paddleApiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Never forward the provider's raw error body to the browser; log a short
    // diagnostic server-side only.
    console.error(`[paddle-api] ${method} ${path} -> ${res.status}`);
    throw new PaddleApiError(res.status, "The billing provider rejected the request");
  }
  return (await res.json()) as T;
}

/** Cancel at the end of the paid period, or immediately. */
export async function cancelPaddleSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
  await paddleRequest("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    effective_from: atPeriodEnd ? "next_billing_period" : "immediately",
  });
}

/** Remove a scheduled cancellation so the subscription keeps renewing. */
export async function removePaddleScheduledCancellation(subscriptionId: string): Promise<void> {
  await paddleRequest("PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    scheduled_change: null,
  });
}

/** Authenticated customer-portal link (manage payment method, invoices). */
export async function createPaddlePortalUrl(customerId: string, subscriptionIds: string[] = []): Promise<string> {
  const json = await paddleRequest<{ data?: { urls?: { general?: { overview?: string } } } }>(
    "POST",
    `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
    subscriptionIds.length ? { subscription_ids: subscriptionIds } : {}
  );
  const url = json.data?.urls?.general?.overview;
  if (!url) throw new PaddleApiError(502, "No portal URL returned");
  return url;
}
