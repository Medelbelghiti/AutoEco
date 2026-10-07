"use client";

import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { READY_LOCALES, LOCALE_NAMES, coerceLocale, translator, errorText, type Locale } from "@/lib/i18n";

/**
 * Every form here takes the locale as a prop rather than reading it itself.
 *
 * They are client components, so they cannot call `cookies()`; the server
 * page that renders them already resolved the request locale and passes it
 * down, which also keeps the server and client renders in agreement.
 */
export function Profile({ name, email, locale }: { name: string; email: string; locale: string }) {
  const router = useRouter();
  const t = translator(coerceLocale(locale));
  const [n, setN] = useState(name);
  const [l, setL] = useState(locale);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    document.cookie = "lg_locale=" + l + "; path=/; max-age=" + 60 * 60 * 24 * 365;
    const r = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, locale: l }) });
    setBusy(false);
    setMsg(r.ok ? t("common.saved") : t("common.failed"));
    if (r.ok) router.refresh();
  };

  return (
    <form onSubmit={save} className="mt-3 space-y-3">
<div><label className="label" htmlFor="profile-name">{t("common.name")}</label><input id="profile-name" className="input" value={n} onChange={(e) => setN(e.target.value)} autoComplete="name" /></div>
      <div><label className="label" htmlFor="profile-email">{t("common.email")}</label><input id="profile-email" className="input" value={email} disabled readOnly /></div>
      <div>
        <label className="label" htmlFor="profile-locale">{t("settings.language")}</label>
        <select id="profile-locale" className="select" value={l} onChange={(e) => setL(e.target.value)}>
          {READY_LOCALES.map((x) => (
            <option key={x} value={x}>{LOCALE_NAMES[x]}</option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t("common.saving") : t("common.save")}</button>
      {msg && <span className="text-sm text-charcoal-500 ms-2" role="status">{msg}</span>}
    </form>
  );
}

export function Preferences({ currency, distanceUnit, fuelUnit, locale }: { userId: string; currency: string; distanceUnit: string; fuelUnit: string; locale: string }) {
  const router = useRouter();
  const t = translator(coerceLocale(locale));
  const [c, setC] = useState(currency);
  const [d, setD] = useState(distanceUnit);
  const [f, setF] = useState(fuelUnit);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency: c, distanceUnit: d, fuelUnit: f }) });
    setBusy(false);
    router.refresh();
  };
  return (
    <form onSubmit={save} className="mt-3 space-y-3">
<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className="label" htmlFor="pref-currency">{t("settings.currency")}</label>
          <select id="pref-currency" className="select" value={c} onChange={(e) => setC(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div><label className="label" htmlFor="pref-distance">{t("settings.distance")}</label>
          <select id="pref-distance" className="select" value={d} onChange={(e) => setD(e.target.value)}>
            <option value="km">{t("settings.unit_km")}</option><option value="mi">{t("settings.unit_mi")}</option>
          </select>
        </div>
        <div><label className="label" htmlFor="pref-fuel">{t("settings.fuel_unit")}</label>
          <select id="pref-fuel" className="select" value={f} onChange={(e) => setF(e.target.value)}>
            <option value="L_PER_100KM">L/100km</option><option value="MPG">MPG</option><option value="KM_PER_L">km/L</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t("common.saving") : t("settings.save_prefs")}</button>
    </form>
  );
}

/**
 * The user's own mileage deduction rate.
 *
 * AutoEco has no jurisdiction database, so it cannot know what a deduction is
 * worth to anyone: the rate, its currency and its unit are entered by the user
 * and copied onto each trip as it is logged. Deliberately worded as "your rate"
 * with no claim attached, because that figure is theirs to verify.
 */
export function DeductionRate({ rateCents, currency, unit, locale }: { rateCents: string; currency: string; unit: string; locale: string }) {
  const router = useRouter();
  const t = translator(coerceLocale(locale));
  const [r, setR] = useState(rateCents);
  const [cur, setCur] = useState(currency);
  const [u, setU] = useState(unit);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    // All three fields go together: the API refuses a partial rate, so the form
    // sends all three and lets the server stay the single source of truth.
    const body = r.trim() === ""
      ? { mileageDeductionRateCents: null, mileageDeductionCurrency: null, mileageDeductionUnit: null }
      : { mileageDeductionRateCents: Number(r), mileageDeductionCurrency: cur, mileageDeductionUnit: u };
    const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(errorText(t, j?.code));
      return;
    }
    setMsg(t("settings.rate_saved"));
    router.refresh();
  };

  return (
    <form onSubmit={save} className="mt-3 space-y-3">
      <p className="text-xs text-charcoal-600 dark:text-charcoal-400">
        {t("settings.deduction_body")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor="ded-rate">{t("settings.amount_per_unit")}</label>
          <input
            id="ded-rate"
            className="input"
            type="number"
            step="0.0001"
            min="0"
            inputMode="decimal"
            placeholder={t("settings.deduction_example")}
            value={r}
            onChange={(e) => setR(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="ded-currency">{t("settings.currency")}</label>
          <select id="ded-currency" className="select" value={cur} onChange={(e) => setCur(e.target.value)} disabled={r.trim() === ""}>
            {SUPPORTED_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ded-unit">{t("settings.per_unit_of")}</label>
          <select id="ded-unit" className="select" value={u} onChange={(e) => setU(e.target.value)} disabled={r.trim() === ""}>
            <option value="km">{t("settings.unit_km")}</option>
            <option value="mi">{t("settings.unit_mi")}</option>
          </select>
        </div>
      </div>
      {err && <p role="alert" className="text-xs text-rose-600">{err}</p>}
      {msg && <p role="status" className="text-xs text-charcoal-600 dark:text-charcoal-400">{msg}</p>}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t("common.saving") : t("settings.save_rate")}</button>
    </form>
  );
}

export function ChangePassword({ locale }: { locale: string }) {
  const t = translator(coerceLocale(locale));
  const [current, setC] = useState("");
  const [next, setN] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null);
    const r = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    if (r.ok) { setMsg(t("settings.password_updated")); setC(""); setN(""); }
    else setErr(t("common.failed"));
  };
  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
<label className="sr-only" htmlFor="current-password">{t("settings.current_password")}</label>
      <input id="current-password" className="input" type="password" required placeholder={t("settings.current_password")} value={current} onChange={(e) => setC(e.target.value)} autoComplete="current-password" />
      <label className="sr-only" htmlFor="new-password">{t("settings.new_password")}</label>
      <input id="new-password" className="input" type="password" required minLength={8} placeholder={t("settings.new_password")} value={next} onChange={(e) => setN(e.target.value)} autoComplete="new-password" />
      {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      {msg && <p className="text-sm text-emerald-700" role="status">{msg}</p>}
      <button className="btn btn-primary" type="submit">{t("settings.change_password")}</button>
    </form>
  );
}

export function ExportData({ locale }: { locale: string }) {
  const t = translator(coerceLocale(locale));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const download = (dataset: "all" | "vehicles" | "fuel" | "expenses") => {
    setErr(null);
    setBusy(dataset);
    // A plain navigation to the endpoint triggers the browser's download
    // handler, so we do not need to buffer the CSV in JS.
    const a = document.createElement("a");
    a.href = `/api/export?dataset=${dataset}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => setBusy(null), 1500);
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-charcoal-500">
        {t("settings.export_intro")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => download("all")} disabled={busy !== null}>
          {busy === "all" ? t("common.preparing") : t("settings.download_all")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("vehicles")} disabled={busy !== null}>
          {t("nav.garage")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("fuel")} disabled={busy !== null}>
          {t("nav.fuel")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("expenses")} disabled={busy !== null}>
          {t("nav.expenses")}
        </button>
      </div>
      {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
    </div>
  );
}

export function DeleteAccount({ locale }: { locale: string }) {
  const t = translator(coerceLocale(locale));
  const router = useRouter();
  const [confirm, setC] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The confirmation word stays `DELETE` in every language: it is what the
    // request is checked against, and a localized acceptance would silently
    // change what the server expects.
    if (confirm !== "DELETE") return;
    setErr(null);
    setBusy(true);
    const r = await fetch("/api/auth/account", { method: "DELETE" });
    if (r.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    setBusy(false);
    setErr(t("settings.delete_failed"));
  };
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <p className="text-sm text-charcoal-500">
        {t("settings.delete_body")}
      </p>
      <label className="label" htmlFor="delete-confirm">{t("settings.type_delete")}</label>
      <input
        id="delete-confirm"
        className="input"
        value={confirm}
        onChange={(e) => setC(e.target.value)}
        autoComplete="off"
        disabled={busy}
      />
      {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      <button disabled={confirm !== "DELETE" || busy} className="btn btn-danger" type="submit">
        {busy ? t("common.deleting") : t("settings.delete_account")}
      </button>
    </form>
  );
}

export const SettingsForms = { Profile, Preferences, DeductionRate, ChangePassword, ExportData, DeleteAccount };
