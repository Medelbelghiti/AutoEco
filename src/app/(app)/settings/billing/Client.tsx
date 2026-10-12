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
 *
 * Cancel / resume go through the server routes so the state change is
 * recorded in our own database and reflected by `getEntitlements()`.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaddleButton } from "@/components/PaddleButton";

interface Props {
  hasSubscription?: boolean;
  subCancelAtEnd?: boolean;
  isLifetime?: boolean;
  /** Plan picker mode. */
  isPlanPicker?: boolean;
  planName?: string;
  disabled?: boolean;
  /** Paddle price id resolved server-side via the env mapping. */
  priceId?: string;
  userId?: string;
  planKey?: string;
  /** Optional user email to prefill on the checkout. */
  email?: string;
}

export function BillingClient(props: Props) {
  const router = useRouter();
  const [busy, setB] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const openCustomerPortal = async () => {
    setB(true);
    setMsg(null);
    try {
      // Paddle.js cannot open the customer portal; the server creates an
      // authenticated portal session with the API key.
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || typeof j?.url !== "string") {
        setMsg(typeof j?.error === "string" ? j.error : "Failed to open the billing portal");
        return;
      }
      window.location.assign(j.url);
    } catch {
      setMsg("Could not reach the server. Check your connection and try again.");
    } finally {
      setB(false);
    }
  };

  const post = async (url: string, body?: unknown) => {
    setMsg(null);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setMsg(typeof j?.error === "string" ? j.error : "Something went wrong. Please try again.");
      return false;
    }
    return true;
  };

  const cancel = async (atPeriodEnd: boolean) => {
    setB(true);
    const ok = await post("/api/billing/cancel", { atPeriodEnd });
    setB(false);
    if (ok) {
      setMsg(
        atPeriodEnd
          ? "Cancellation scheduled. You keep access until the end of the current period."
          : "Subscription cancelled. Paid access has ended."
      );
      router.refresh();
    }
  };

  const resume = async () => {
    setB(true);
    const ok = await post("/api/billing/resume");
    setB(false);
    if (ok) {
      setMsg("Subscription resumed.");
      router.refresh();
    }
  };

  if (props.isPlanPicker) {
    const label = props.disabled ? "Your current plan" : `Switch to ${props.planName}`;
    return (
      <div className="mt-3">
        <PaddleButton
          priceId={props.priceId ?? ""}
          userId={props.userId}
          planKey={props.planKey}
          email={props.email}
          disabled={props.disabled}
          label={label}
          className={`w-full text-sm ${props.disabled ? "btn btn-secondary" : "btn btn-accent"}`}
          unavailableHint="No Paddle price id is configured for this plan yet."
        />
        {msg && <p className="text-xs text-rose-600 mt-1" role="alert">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={openCustomerPortal} disabled={busy} className="btn btn-secondary">
          Manage billing
        </button>
        {props.hasSubscription && !props.isLifetime && !props.subCancelAtEnd && (
          <button type="button" onClick={() => cancel(true)} disabled={busy} className="btn btn-secondary">
            Cancel at period end
          </button>
        )}
        {props.hasSubscription && !props.isLifetime && props.subCancelAtEnd && (
          <button type="button" onClick={resume} disabled={busy} className="btn btn-primary">
            Resume subscription
          </button>
        )}
      </div>
      {props.hasSubscription && !props.isLifetime && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-charcoal-500">
            End my subscription immediately
          </summary>
          <button
            type="button"
            onClick={() => cancel(false)}
            disabled={busy}
            className="btn btn-danger mt-2"
          >
            Cancel now and lose paid access
          </button>
        </details>
      )}
      {msg && (
        <p className="text-sm text-charcoal-600 dark:text-charcoal-300" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}