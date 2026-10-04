"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type State = "verifying" | "success" | "error";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  // React 18 StrictMode double-invokes effects in development; the verify
  // endpoint consumes the token, so a second call would report "expired".
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState("error");
      setMessage("This verification link is incomplete. Request a new one from your inbox.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          setState("success");
          setMessage("Your email address is verified.");
          return;
        }
        const j = await res.json().catch(() => ({}));
        setState("error");
        setMessage(typeof j?.error === "string" ? j.error : "This verification link is invalid or has expired.");
      } catch {
        setState("error");
        setMessage("We could not reach the server. Check your connection and try again.");
      }
    })();
  }, [token]);

  return (
    <div className="card mt-6 text-center" role="status" aria-live="polite">
      {state === "verifying" && <p className="text-charcoal-600 dark:text-charcoal-300">Verifying your email…</p>}
      {state === "success" && (
        <>
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">{message}</p>
          <Link href="/dashboard" className="btn btn-primary mt-4 w-full">Go to dashboard</Link>
        </>
      )}
      {state === "error" && (
        <>
          <p className="font-semibold text-rose-700 dark:text-rose-300">{message}</p>
          <Link href="/dashboard" className="btn btn-secondary mt-4 w-full">Continue to AutoEco</Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center">Email verification</h1>
        <Suspense fallback={<p className="text-sm text-center text-charcoal-500 mt-6">Loading…</p>}>
          <VerifyEmailInner />
        </Suspense>
      </div>
    </main>
  );
}