/**
 * Whop REST client (server side only).
 *
 * Plain `fetch` with a pinned `Api-Version-Date`, so the response shapes this
 * code reads cannot change under us when Whop ships a new version. The raw
 * provider error body is never forwarded to the browser.
 *
 * Docs: https://docs.whop.com/api-reference
 */
import { whopApiBase, whopApiKey, whopCompanyId, whopPlanIdFor, type WhopPlanKey } from "./whop";

/** Pinned API version (the one `@whop/sdk` 2.8 sends). Bump deliberately, with tests. */
export const WHOP_API_VERSION_DATE = "2026-11-13-1";

export class WhopApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WhopApiError";
    this.status = status;
  }
}

async function whopRequest<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const key = whopApiKey();
  if (!key) throw new WhopApiError(503, "Whop is not configured");
  const res = await fetch(`${whopApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Api-Version-Date": WHOP_API_VERSION_DATE,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Short server-side diagnostic only: never the key, never the body.
    console.error(`[whop-api] ${method} ${path.split("?")[0]} -> ${res.status}`);
    throw new WhopApiError(res.status, "The billing provider rejected the request");
  }
  return (await res.json()) as T;
}

/**
 * Create a hosted checkout for one of our plans and return its URL.
 *
 * `metadata.userId` is what lets the webhook attribute the membership and its
 * payments to the AutoEco account; Whop copies checkout metadata onto both.
 */
export async function createWhopCheckout(params: {
  planKey: WhopPlanKey;
  userId: string;
  redirectUrl: string;
}): Promise<string> {
  const planId = whopPlanIdFor(params.planKey);
  if (!planId) throw new WhopApiError(503, `No Whop plan id configured for "${params.planKey}"`);
  const json = await whopRequest<{ purchase_url?: string | null; id?: string }>("POST", "/checkout_configurations", {
    account_id: whopCompanyId() || undefined,
    variant_id: planId,
    metadata: { userId: params.userId, planKey: params.planKey, brand: "AutoEco" },
    redirect_url: params.redirectUrl,
  });
  const url = json.purchase_url;
  if (!url || !/^https:\/\//.test(url)) throw new WhopApiError(502, "No checkout URL returned");
  return url;
}

export interface WhopMembershipView {
  id: string;
  status: string | null;
  manage_url: string | null;
  cancel_at_period_end: boolean;
}

export async function getWhopMembership(membershipId: string): Promise<WhopMembershipView> {
  return whopRequest<WhopMembershipView>("GET", `/memberships/${encodeURIComponent(membershipId)}`);
}

/** Cancel at the end of the paid period (`atPeriodEnd`), or immediately. */
export async function cancelWhopMembership(membershipId: string, atPeriodEnd: boolean): Promise<void> {
  await whopRequest("POST", `/memberships/${encodeURIComponent(membershipId)}/cancel`, {
    cancel_at_period_end: atPeriodEnd,
  });
}

/** Reverse a pending end-of-period cancellation so the membership keeps renewing. */
export async function uncancelWhopMembership(membershipId: string): Promise<void> {
  await whopRequest("PATCH", `/memberships/${encodeURIComponent(membershipId)}`, {
    cancel_at_period_end: false,
  });
}

/** Whop's own self-service page for a membership (payment method, receipts, cancel). */
export async function getWhopManageUrl(membershipId: string): Promise<string> {
  const m = await getWhopMembership(membershipId);
  if (!m.manage_url || !/^https:\/\//.test(m.manage_url)) throw new WhopApiError(502, "No manage URL returned");
  return m.manage_url;
}
