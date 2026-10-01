"use client";

/**
 * BillingClient — opens the Paddle.js checkout for the selected price.
 *
 * We deliberately do NOT use server-side checkout redirects. Paddle's
 * recommended pattern is to open the checkout in the browser via
 * Paddle.js; the server-side webhook (`/api/paddle/webhook`) is then the
 * authoritative source of entitlement.
 *
 * The "Manage billing" action opens the Paddle Customer Portal (also
 * client-side) which lets users cancel / update card / download
 * invoices. We never expose Paddle API credentials to the browser.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaddleButton } from "@/components/PaddleButton";

interface Props {
  hasSubscription?: boolean;
  subCancelAtEnd?: boolean;
  isLifetime?: boolean;
  hasStripeCustomer?: boolean;
  billingEnabled?: boolean;
  isPlanPicker?: boolean;
  planId?: string;       // legacy: Paddle price id (server may also pass it)
  planName?: string;
  disabled?: boolean;
  /** Internal plan key passed from the page (pro | business | pro_plus | lifetime). */
  planKey?: "pro" | "business" | "pro_plus" | "lifetime";
  /** Paddle price id resolved server-side via the env mapping. */
  priceId?: string;
  /** Optional user email to prefill on the checkout. */
  email?: string;
  /** Display name for the plan (shown in the button label). */
}

export function BillingClient(props: Props) {
  const router = useRouter();
  const [busy, setB] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [coupon, setC] = useState("");

  const openCustomerPortal = async () => {
    if (typeof window === "undefined" || !window.Paddle) {
      setMsg("Paddle.js is not loaded yet. Try again in a moment.");
      return;
    }
    try {
      window.Paddle.CustomerPortal.open({
        ...(props.email ? { customer: { email: props.email } } : {}),
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to open the customer portal");
    }
  };

  const cancel = async (atPeriodEnd: boolean) => {
    setB(true);
    // Paddle cancellations happen in the Customer Portal (client-side).
    // The server-side cancel endpoint is preserved for legacy Stripe
    // customers only.
    const r = await fetch("/api/billing/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atPeriodEnd }),
    });
    setB(false);
    setMsg(r.ok ? `Cancellation ${atPeriodEnd ? "scheduled at period end" : "processed immediately"}` : (await r.json()).error);
    router.refresh();
  };

  const resume = async () => {
    setB(true);
    const r = await fetch("/api/billing/resume", { method: "POST" });
    setB(false);
    setMsg(r.ok ? "Subscription resumed" : (await r.json()).error);
    router.refresh();
  };

  if (props.isPlanPicker) {
    return (
      <div className="mt-2">
        <input className="input mb-2" placeholder="Coupon (optional)" value={coupon} onChange={(e) => setC(e.target.value)} />
        <PaddleButton priceId={props.priceId ?? ""} email={props.email} label={busy ? "…" : `Switch to ${props.planName}`} className="btn btn-secondary text-sm w-full" />
        {msg && <p className="text-xs text-rose-600 mt-1">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button onClick={openCustomerPortal} disabled={busy} className="btn btn-secondary">
          Manage billing
        </button>
        {props.hasSubscription && !props.isLifetime && !props.subCancelAtEnd && (
          <button onClick={() => cancel(true)} disabled={busy} className="btn btn-secondary">
            Cancel at period end
          </button>
        )}
        {props.hasSubscription && !props.isLifetime && props.subCancelAtEnd && (
          <button onClick={resume} disabled={busy} className="btn btn-primary">
            Resume
          </button>
        )}
        {props.hasSubscription && !props.isLifetime && (
          <button onClick={() => cancel(false)} disabled={busy} className="btn btn-danger">
            Cancel now
          </button>
        )}
      </div>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
