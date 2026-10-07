"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Turnstile, turnstileRequired } from "@/components/Turnstile";
import { useLocale, useT } from "@/components/LocaleProvider";
import { errorText } from "@/lib/i18n";

/**
 * Only same-origin, absolute-path redirects are allowed. This blocks
 * `?next=https://evil.example` and `?next=//evil.example`.
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  return raw;
}

/**
 * Plan names are product names, not prose, so they are left alone the same way
 * the brand is. The surrounding sentence is still translated around them.
 */
const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  family: "Family",
  pro_plus: "Pro Plus",
};

function SignupForm() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const plan = params.get("plan");
  const planLabel = plan ? PLAN_LABELS[plan] : undefined;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const redirectTo = useMemo(() => safeNext(params.get("next")), [params]);
  const tooShort = password.length > 0 && password.length < 8;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t("auth.signup.too_short"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The chosen language is part of the account: it is stored on the
        // profile and mirrored into a cookie, so the interface this visitor
        // already picked is the one they keep after signing up.
        body: JSON.stringify({ name, email, password, captchaToken, locale }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(errorText(t, j?.code));
        setLoading(false);
        return;
      }
      router.push(redirectTo ?? "/onboarding");
      router.refresh();
    } catch {
      setError(t("common.network_error"));
      setLoading(false);
    }
  };

  return (
    <>
      {planLabel && (
        <p className="card text-sm text-center mb-4" role="status">
          {t("auth.signup.plan_choice", { plan: planLabel })}
        </p>
      )}
      <h1 className="text-2xl font-bold text-center">{t("auth.signup.title")}</h1>
      <p className="text-sm text-center text-charcoal-500 mt-1">{t("auth.signup.subtitle")}</p>
      <form onSubmit={submit} className="card mt-6 space-y-3">
        <div>
          <label htmlFor="name" className="label">{t("common.name")}</label>
          <input
            id="name"
            name="name"
            className="input"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
        <div>
          <label htmlFor="password" className="label">{t("common.password")}</label>
          <input
            id="password"
            name="password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort || undefined}
            aria-describedby="password-help"
          />
          <p id="password-help" className="mt-1 text-xs text-charcoal-500">
            {t("auth.signup.password_hint")}
          </p>
          {tooShort && <p className="text-xs text-rose-600" role="alert">{t("auth.signup.too_short")}</p>}
        </div>
        <Turnstile onToken={setCaptchaToken} />
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" disabled={loading || tooShort || (turnstileRequired && !captchaToken)}>
          {loading ? t("auth.signup.creating") : t("auth.signup.submit")}
        </button>
      </form>
      <p className="text-xs text-charcoal-500 mt-4 text-center">
        {t("auth.signup.legal_prefix")} <Link href="/terms" className="underline">{t("legal.terms")}</Link> {t("auth.signup.legal_and")}{" "}
        <Link href="/privacy" className="underline">{t("legal.privacy")}</Link>.
      </p>
      <p className="text-sm mt-2 text-center">
        {t("auth.signup.have_account")} <Link href="/login" className="underline">{t("nav.login")}</Link>
      </p>
      <p className="text-sm mt-2 text-center text-charcoal-500">
        {t("auth.signup.not_ready")}{" "}
        <Link href="/calculators/car-cost" className="underline">
          {t("auth.signup.calc_link")}
        </Link>
      </p>
    </>
  );
}

export default function SignupPage() {
  const t = useT();
  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <Suspense fallback={<p className="text-sm text-center text-charcoal-500">{t("common.loading")}</p>}>
          <SignupForm />
        </Suspense>
      </div>
    </main>
  );
}
