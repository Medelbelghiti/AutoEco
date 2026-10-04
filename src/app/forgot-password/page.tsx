"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Forgot-password request form.
 * POSTs to /api/auth/forgot-password, which always answers 200 so we never
 * reveal whether an email exists. The same confirmation is shown either way.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j?.error === "string" ? j.error : "Could not send the reset email. Try again.");
      return;
    }
    setSent(true);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center">Reset your password</h1>

        {sent ? (
          <div className="card mt-6 text-center" role="status">
            <p className="font-semibold">Check your inbox</p>
            <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-2">
              If an account exists for <strong>{email}</strong>, we sent a link to set a new password.
              The link expires in 1 hour.
            </p>
            <Link href="/login" className="btn btn-primary mt-5 w-full">
              Back to log in
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-center text-charcoal-500 mt-2">
              Enter the email you use for AutoEco and we&apos;ll send you a reset link.
            </p>
            <form onSubmit={submit} className="card mt-6 space-y-3">
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input
                  id="email"
                  name="email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="text-sm mt-4 text-center text-charcoal-500">
              <Link href="/login" className="underline">Back to log in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}