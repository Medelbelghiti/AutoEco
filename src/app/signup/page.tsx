"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Turnstile, turnstileRequired } from "@/components/Turnstile";

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

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  family: "Family",
  pro_plus: "Pro Plus",
};

function SignupForm() {
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
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, captchaToken }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(typeof j?.error === "string" ? j.error : "Signup failed. Please try again.");
        setLoading(false);
        return;
      }
      router.push(redirectTo ?? "/onboarding");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <>
      {planLabel && (
        <p className="card text-sm text-center mb-4" role="status">
          You chose the <strong>{planLabel}</strong> plan. Create your free account first — you can
          activate {planLabel} right after, from{" "}
          <Link href="/settings/billing" className="underline">Settings → Billing</Link>.
        </p>
      )}
      <h1 className="text-2xl font-bold text-center">Create your AutoEco account</h1>
      <p className="text-sm text-center text-charcoal-500 mt-1">Free to start. No credit card required.</p>
      <form onSubmit={submit} className="card mt-6 space-y-3">
        <div>
          <label htmlFor="name" className="label">Name</label>
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
        <div>
          <label htmlFor="password" className="label">Password</label>
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
            At least 8 characters.
          </p>
          {tooShort && <p className="text-xs text-rose-600" role="alert">Password must be at least 8 characters.</p>}
        </div>
        <Turnstile onToken={setCaptchaToken} />
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" disabled={loading || tooShort || (turnstileRequired && !captchaToken)}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="text-xs text-charcoal-500 mt-4 text-center">
        By signing up you agree to our <Link href="/terms" className="underline">Terms</Link> and{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
      <p className="text-sm mt-2 text-center">
        Already have an account? <Link href="/login" className="underline">Log in</Link>
      </p>
      <p className="text-sm mt-2 text-center text-charcoal-500">
        Not ready to sign up?{" "}
        <Link href="/calculators/car-cost" className="underline">
          Calculate your car cost first
        </Link>
        .
      </p>
    </>
  );
}

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <Suspense fallback={<p className="text-sm text-center text-charcoal-500">Loading…</p>}>
          <SignupForm />
        </Suspense>
      </div>
    </main>
  );
}