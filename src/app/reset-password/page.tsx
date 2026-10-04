"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j?.error === "string" ? j.error : "This reset link is invalid or has expired.");
      return;
    }
    setDone(true);
    // The API clears the session on success; send them to log in.
    setTimeout(() => router.push("/login"), 1500);
  };

  if (!token) {
    return (
      <div className="card mt-6" role="alert">
        <p className="font-semibold">This link is incomplete</p>
        <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-1">
          The reset link is missing its token. Request a new one from the{" "}
          <Link href="/forgot-password" className="underline">forgot password</Link> page.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card mt-6" role="status">
        <p className="font-semibold text-emerald-700 dark:text-emerald-300">Password updated</p>
        <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-1">
          You have been signed out. Redirecting you to log in…
        </p>
        <Link href="/login" className="btn btn-primary mt-4 w-full">Log in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card mt-6 space-y-3">
      <div>
        <label htmlFor="new-password" className="label">New password</label>
        <input
          id="new-password"
          name="new-password"
          className="input"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-help"
        />
        <p id="password-help" className="mt-1 text-xs text-charcoal-500">
          At least 8 characters.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="label">Confirm new password</label>
        <input
          id="confirm-password"
          name="confirm-password"
          className="input"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
        />
        {mismatch && <p className="mt-1 text-xs text-rose-600" role="alert">The two passwords do not match.</p>}
      </div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy || mismatch}>
        {busy ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center">Choose a new password</h1>
        <Suspense fallback={<p className="text-sm text-center text-charcoal-500 mt-6">Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}