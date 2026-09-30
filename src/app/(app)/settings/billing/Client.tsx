"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  hasSubscription?: boolean;
  subCancelAtEnd?: boolean;
  isLifetime?: boolean;
  hasStripeCustomer?: boolean;
  billingEnabled?: boolean;
  isPlanPicker?: boolean;
  planId?: string;
  planName?: string;
  disabled?: boolean;
}

export function BillingClient(props: Props) {
  const router = useRouter();
  const [busy, setB] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [coupon, setC] = useState("");

  const portal = async () => {
    setB(true); setMsg(null);
    const r = await fetch("/api/billing/portal", { method: "POST" });
    setB(false);
    if (!r.ok) { setMsg((await r.json()).error); return; }
    const j = await r.json();
    window.location.href = j.url;
  };

  const cancel = async (atPeriodEnd: boolean) => {
    setB(true);
    const r = await fetch("/api/billing/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ atPeriodEnd }) });
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

  const checkout = async () => {
    setB(true); setMsg(null);
    const r = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: props.planId, couponCode: coupon || undefined }),
    });
    setB(false);
    if (!r.ok) { setMsg((await r.json()).error); return; }
    const j = await r.json();
    window.location.href = j.url;
  };

  if (props.isPlanPicker) {
    return (
      <div className="mt-2">
        <input className="input mb-2" placeholder="Coupon (optional)" value={coupon} onChange={(e) => setC(e.target.value)} />
        <button onClick={checkout} disabled={props.disabled || busy || !props.billingEnabled} className="btn btn-secondary text-sm w-full">
          {props.disabled ? "Current plan" : !props.billingEnabled ? "Billing not configured" : busy ? "…" : `Switch to ${props.planName}`}
        </button>
        {msg && <p className="text-xs text-rose-600 mt-1">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {props.hasStripeCustomer && props.billingEnabled && (
          <button onClick={portal} disabled={busy} className="btn btn-secondary">Manage billing</button>
        )}
        {props.hasSubscription && !props.isLifetime && !props.subCancelAtEnd && (
          <button onClick={() => cancel(true)} disabled={busy} className="btn btn-secondary">Cancel at period end</button>
        )}
        {props.hasSubscription && !props.isLifetime && props.subCancelAtEnd && (
          <button onClick={resume} disabled={busy} className="btn btn-primary">Resume</button>
        )}
        {props.hasSubscription && !props.isLifetime && (
          <button onClick={() => cancel(false)} disabled={busy} className="btn btn-danger">Cancel now</button>
        )}
      </div>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
