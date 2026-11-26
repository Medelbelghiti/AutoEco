"use client";

/**
 * Starts a Whop hosted checkout for one of our plans.
 *
 * The button asks our server for a checkout URL (`POST /api/billing/checkout`)
 * and navigates there. No Whop script, key or plan id ever reaches the
 * browser: the server maps the plan key and attaches the account metadata.
 * After payment Whop sends the buyer back to /settings/billing, and the
 * signed webhook grants access.
 */
import { useState } from "react";

interface Props {
  planKey: "pro" | "pro_plus" | "lifetime";
  label: string;
  className?: string;
  disabled?: boolean;
  /** Shown under the button when checkout cannot be started. */
  unavailableHint?: string;
}

export function WhopCheckoutButton({ planKey, label, className, disabled, unavailableHint }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || typeof j?.url !== "string") {
        setError(typeof j?.error === "string" ? j.error : "Could not start checkout. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(j.url);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  const blocked = Boolean(disabled) || busy;
  const hint = error ?? (disabled ? unavailableHint : null);

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={blocked}
        aria-disabled={blocked}
        aria-busy={busy}
        className={className ?? "btn btn-primary"}
      >
        {busy ? "Redirecting…" : label}
      </button>
      {hint && (
        <p className="mt-1 text-[11px] leading-snug text-charcoal-500" role={error ? "alert" : undefined}>
          {hint}
        </p>
      )}
    </div>
  );
}
