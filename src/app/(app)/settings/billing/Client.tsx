"use client";

/**
 * BillingClient — plan picker + subscription controls.
 *
 * "Switch to …" starts a Whop hosted checkout (via `/api/billing/checkout`);
 * the signed webhook (`/api/whop/webhook`) is the authoritative source of
 * entitlement. When a new plan activates, the webhook schedules the previous
 * membership to end at its period end, so nobody is billed twice.
 *
 * "Manage billing" opens Whop's own membership page (payment method,
 * receipts). Cancel / resume go through our server routes so the change is
 * recorded in our database and reflected by `getEntitlements()`. No Whop
 * credential ever reaches the browser.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WhopCheckoutButton } from "@/components/WhopCheckoutButton";

interface Props {
  hasSubscription?: boolean;
  subCancelAtEnd?: boolean;
  /** Plan picker mode. */
  isPlanPicker?: boolean;
  planName?: string;
  disabled?: boolean;
  /** Internal plan key the checkout is for. */
  planKey?: "pro" | "pro_plus";
  /** False when this plan has no Whop plan configured on the server. */
  purchasable?: boolean;
}

export function BillingClient(props: Props) {
  const router = useRouter();
  const [busy, setB] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const openCustomerPortal = async () => {
    setB(true);
    setMsg(null);
    try {
      // The server looks up Whop's management URL with the API key.
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
        {props.planKey ? (
          <WhopCheckoutButton
            planKey={props.planKey}
            disabled={props.disabled || !props.purchasable}
            label={label}
            className={`w-full text-sm ${props.disabled ? "btn btn-secondary" : "btn btn-accent"}`}
            unavailableHint={props.disabled ? undefined : "Checkout is not configured for this plan yet."}
          />
        ) : (
          <button type="button" disabled className="btn btn-secondary w-full text-sm">
            {label}
          </button>
        )}
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
        {props.hasSubscription && !props.subCancelAtEnd && (
          <button type="button" onClick={() => cancel(true)} disabled={busy} className="btn btn-secondary">
            Cancel at period end
          </button>
        )}
        {props.hasSubscription && props.subCancelAtEnd && (
          <button type="button" onClick={resume} disabled={busy} className="btn btn-primary">
            Resume subscription
          </button>
        )}
      </div>
      {props.hasSubscription && (
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