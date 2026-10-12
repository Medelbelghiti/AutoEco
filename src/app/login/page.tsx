"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/LocaleProvider";
import { errorText } from "@/lib/i18n";

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(errorText(t, j?.code));
        setLoading(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("common.network_error"));
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-950 p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center">{t("auth.login.title")}</h1>
        <p className="text-sm text-center text-charcoal-500 mt-1">
          {t("auth.login.subtitle")}
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
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="label">{t("common.password")}</label>
              <Link href="/forgot-password" className="text-xs text-charcoal-500 underline">
                {t("auth.login.forgot")}
              </Link>
            </div>
            <input
              id="password"
              name="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? t("auth.login.logging_in") : t("nav.login")}
          </button>
        </form>
        <p className="text-sm mt-4 text-center text-charcoal-500">
          {t("auth.login.new_here")} <Link href="/signup" className="underline">{t("auth.login.create_account")}</Link>
        </p>
        <p className="text-sm mt-2 text-center text-charcoal-500">
          {t("auth.login.want_estimate")}{" "}
          <Link href="/calculators/car-cost" className="underline">
            {t("auth.login.calc_link")}
          </Link>
        </p>
      </div>
    </main>
  );
}