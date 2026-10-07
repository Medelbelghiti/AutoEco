"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/LocaleProvider";
import { errorKey } from "@/lib/i18n";

type State = "verifying" | "success" | "error";

/**
 * Every message this page shows is a translation key; the API's English
 * strings are never echoed. The verify endpoint returns a stable `code`
 * (`AUTH_INVALID_TOKEN`) or nothing, which maps to the "invalid link" text.
 */
function render(t: (k: string) => string, key: string): string {
  return t(key);
}

function VerifyEmailInner() {
  const t = useT();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState<string>("auth.verify.verifying");
  // React 18 StrictMode double-invokes effects in development; the verify
  // endpoint consumes the token, so a second call would report "expired".
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState("error");
      setMessage("auth.verify.incomplete");
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
          setMessage("auth.verify.success");
          return;
        }
        const j = await res.json().catch(() => ({}));
        setState("error");
        setMessage(errorKey(j?.code));
      } catch {
        setState("error");
        setMessage("common.network_error");
      }
    })();
  }, [token]);

  return (
    <div className="card mt-6 text-center" role="status" aria-live="polite">
      {state === "verifying" && <p className="text-charcoal-600 dark:text-charcoal-300">{render(t, message)}</p>}
      {state === "success" && (
        <>
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">{render(t, message)}</p>
          <Link href="/dashboard" className="btn btn-primary mt-4 w-full">{t("auth.verify.go_dashboard")}</Link>
        </>
      )}
      {state === "error" && (
        <>
          <p className="font-semibold text-rose-700 dark:text-rose-300">{render(t, message)}</p>
          <Link href="/dashboard" className="btn btn-secondary mt-4 w-full">{t("auth.verify.continue")}</Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center">{t("auth.verify.title")}</h1>
        <Suspense fallback={<p className="text-sm text-center text-charcoal-500 mt-6">{t("common.loading")}</p>}>
          <VerifyEmailInner />
        </Suspense>
      </div>
    </main>
  );
}
