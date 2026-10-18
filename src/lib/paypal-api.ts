/**
 * Thin PayPal REST client — server side only.
 *
 * Every HTTP call goes through this module so tests can mock a single
 * `global.fetch` and no route ever contacts PayPal directly. Errors are
 * normalised into `PaypalApiError`, which never carries PayPal's response
 * body: that body can echo request details and must not reach a client.
 *
 * Amounts are sent as decimal strings in the configured currency. Nothing
 * card-related is ever read or stored.
 */
import {
  paypalApiBase,
  paypalClientId,
  paypalClientSecret,
  paypalWebhookId,
  paypalAmountToMinor,
} from "./paypal";

export class PaypalApiError extends Error {
  status: number;
  constructor(status: number, message = "PayPal request failed") {
    super(message);
    this.status = status;
  }
}

export interface PaypalOrderView {
  orderId: string | null;
  status: string;
  customId: string | null;
  captureId: string | null;
  captureStatus: string | null;
  amountMinor: number | null;
  currency: string | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function minorToPaypalAmount(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

async function getAccessToken(): Promise<string> {
  const id = paypalClientId();
  const secret = paypalClientSecret();
  if (!id || !secret) throw new PaypalApiError(503, "PayPal is not configured");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  const token = asString(body?.access_token);
  if (!res.ok || !token) throw new PaypalApiError(res.status || 502, "Could not authenticate with PayPal");
  return token;
}

async function paypalRequest(
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: unknown }> {
  const token = await getAccessToken();
  const res = await fetch(`${paypalApiBase()}${path}`, {
    method: init.method,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    body: init.body,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function normalizeOrder(body: unknown): PaypalOrderView {
  const b = asRecord(body);
  const units = Array.isArray(b.purchase_units) ? b.purchase_units : [];
  const pu = asRecord(units[0]);
  const payments = asRecord(pu.payments);
  const captures = Array.isArray(payments.captures) ? payments.captures : [];
  const cap = asRecord(captures[0]);
  const capAmount = asRecord(cap.amount);
  const puAmount = asRecord(pu.amount);
  const amountValue = capAmount.value ?? puAmount.value;
  const currency = asString(capAmount.currency_code) ?? asString(puAmount.currency_code);
  return {
    orderId: asString(b.id),
    status: asString(b.status) ?? "",
    customId: asString(pu.custom_id),
    captureId: asString(cap.id),
    captureStatus: asString(cap.status),
    amountMinor: paypalAmountToMinor(amountValue),
    currency: currency ? currency.toUpperCase() : null,
  };
}

/** Create a one-time order. `userId` is echoed back by PayPal as `custom_id`. */
export async function createPaypalOrder(params: {
  amountMinor: number;
  currency: string;
  userId: string;
}): Promise<{ orderId: string }> {
  const { status, body } = await paypalRequest("/v2/checkout/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: params.userId,
          amount: {
            currency_code: params.currency,
            value: minorToPaypalAmount(params.amountMinor),
          },
        },
      ],
    }),
  });
  const orderId = asString(asRecord(body).id);
  if (status >= 400 || !orderId) throw new PaypalApiError(status, "PayPal could not create the order");
  return { orderId };
}

/** Capture an approved order and return the normalised result. */
export async function capturePaypalOrder(orderId: string): Promise<PaypalOrderView> {
  const { status, body } = await paypalRequest(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    { method: "POST", headers: { "Content-Type": "application/json" } }
  );
  if (status >= 400) throw new PaypalApiError(status, "PayPal could not capture the order");
  return normalizeOrder(body);
}

/** Read an order's current state (used to re-confirm after an already-captured error). */
export async function getPaypalOrder(orderId: string): Promise<PaypalOrderView> {
  const { status, body } = await paypalRequest(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" }
  );
  if (status >= 400) throw new PaypalApiError(status, "PayPal could not read the order");
  return normalizeOrder(body);
}

/**
 * Verify an incoming webhook signature via PayPal's own API. FAILS CLOSED:
 * a missing header, an unparseable body, a network error or any non-SUCCESS
 * verification status all return false, and the caller must reject the event.
 */
export async function verifyPaypalWebhookSignature(params: {
  headers: Headers;
  rawBody: string;
}): Promise<boolean> {
  const webhookId = paypalWebhookId();
  const transmissionId = params.headers.get("paypal-transmission-id");
  const transmissionTime = params.headers.get("paypal-transmission-time");
  const transmissionSig = params.headers.get("paypal-transmission-sig");
  const certUrl = params.headers.get("paypal-cert-url");
  const authAlgo = params.headers.get("paypal-auth-algo");
  if (!webhookId || !transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return false;
  }

  let event: unknown;
  try {
    event = JSON.parse(params.rawBody);
  } catch {
    return false;
  }

  try {
    const { status, body } = await paypalRequest("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        transmission_sig: transmissionSig,
        cert_url: certUrl,
        auth_algo: authAlgo,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    if (status >= 400) return false;
    return asRecord(body).verification_status === "SUCCESS";
  } catch {
    return false;
  }
}
