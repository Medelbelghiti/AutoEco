"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/LocaleProvider";
import { errorText } from "@/lib/i18n";

/**
 * Forgot-password request form.
 * POSTs to /api/auth/forgot-password, which always answers 200 so we never
 * reveal whether an email exists. The same confirmation is shown either way.
 */
export default function ForgotPasswordPage() {
  const t = useT();
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
      setError(errorText(t, j?.code));
      return;
    }
    setSent(true);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center">{t("auth.forgot.title")}</h1>

        {sent ? (
          <div className="card mt-6 text-center" role="status">
            <p className="font-semibold">{t("auth.forgot.check_inbox")}</p>
            <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-2">
              {t("auth.forgot.sent_body", { email })}
            </p>
            <Link href="/login" className="btn btn-primary mt-5 w-full">
              {t("auth.login.back_to_login")}
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-center text-charcoal-500 mt-2">
              {t("auth.forgot.intro")}
            </p>
            <form onSubmit={submit} className="card mt-6 space-y-3">
              <div>
                <label htmlFor="email" className="label">{t("common.email")}</label>
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
                {busy ? t("common.sending") : t("auth.forgot.send")}
              </button>
            </form>
            <p className="text-sm mt-4 text-center text-charcoal-500">
              <Link href="/login" className="underline">{t("auth.login.back_to_login")}</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
