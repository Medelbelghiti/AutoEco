"use client";

/**
 * PayPal Buttons for the one-time "Founder Lifetime" purchase.
 *
 * The public PayPal JS SDK is loaded from https://www.paypal.com/sdk/js (never
 * bundled) and is idempotent. The client id and currency come from the SERVER
 * component as props (read from `PAYPAL_CLIENT_ID`/`LIFETIME_CURRENCY`), so no
 * credential is embedded and a misconfigured server simply does not render the
 * button.
 *
 * Flow:
 *   createOrder  -> POST /api/billing/paypal/create-order (server decides the
 *                   amount; the browser never sends one)
 *   onApprove    -> POST /api/billing/paypal/capture-order (server re-reads
 *                   PayPal's state and grants idempotently), then refresh.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PayPalButtonsConfig {
  style?: Record<string, string>;
  createOrder?: () => Promise<string>;
  onApprove?: (data: { orderID: string }) => Promise<void>;
  onError?: (err: unknown) => void;
}

interface PayPalButtonsInstance {
  render: (target: HTMLElement) => Promise<void>;
}

interface PayPalNamespace {
  Buttons: (config: PayPalButtonsConfig) => PayPalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

function ensurePaypalSdk(clientId: string, currency: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.paypal) return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("PayPal could not be loaded")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId
    )}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
    script.async = true;
    script.dataset.paypalSdk = "1";
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("PayPal could not be loaded")));
    document.head.appendChild(script);
  });
}

interface Props {
  /** Public PayPal client id; empty string renders the unavailable state. */
  clientId: string;
  currency: string;
  label: string;
  /** Rendered when checkout cannot be offered (not configured, cap reached). */
  unavailableHint?: string;
}

export function PayPalLifetimeButton({ clientId, currency, label, unavailableHint }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setError(unavailableHint ?? "Checkout is not available right now.");
      return;
    }
    let cancelled = false;
    ensurePaypalSdk(clientId, currency)
      .then(() => {
        if (cancelled || !window.paypal || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        window.paypal
          .Buttons({
            style: { layout: "vertical", shape: "rect", label: "paypal" },
            createOrder: async () => {
              const res = await fetch("/api/billing/paypal/create-order", { method: "POST" });
              const data = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string };
              if (!res.ok || !data.orderId) throw new Error(data.error ?? "Could not start checkout.");
              return data.orderId;
            },
            onApprove: async (data: { orderID: string }) => {
              const res = await fetch("/api/billing/paypal/capture-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: data.orderID }),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                setError(body.error ?? "Payment could not be completed.");
                return;
              }
              router.refresh();
            },
            onError: (err: unknown) =>
              setError(err instanceof Error ? err.message : "PayPal checkout failed."),
          })
          .render(containerRef.current);
        setReady(true);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "PayPal could not be loaded.")
      );
    return () => {
      cancelled = true;
    };
  }, [clientId, currency, router, unavailableHint]);

  return (
    <div>
      <div ref={containerRef} aria-label={label} className="min-h-[44px]" />
      {error && <p className="mt-1 text-[11px] leading-snug text-charcoal-500">{error}</p>}
      {!ready && !error && unavailableHint && (
        <p className="mt-1 text-[11px] leading-snug text-charcoal-500">{unavailableHint}</p>
      )}
    </div>
  );
}
