"use client";

import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function Profile({ name, email, locale }: { name: string; email: string; locale: string }) {
  const router = useRouter();
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
    setMsg(r.ok ? "Saved" : "Failed");
    if (r.ok) router.refresh();
  };

  return (
    <form onSubmit={save} className="mt-3 space-y-3">
<div><label className="label" htmlFor="profile-name">Name</label><input id="profile-name" className="input" value={n} onChange={(e) => setN(e.target.value)} autoComplete="name" /></div>
      <div><label className="label" htmlFor="profile-email">Email</label><input id="profile-email" className="input" value={email} disabled readOnly /></div>
      <div>
        <label className="label" htmlFor="profile-locale">Locale</label>
        <select id="profile-locale" className="select" value={l} onChange={(e) => setL(e.target.value)}>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button>
      {msg && <span className="text-sm text-charcoal-500 ml-2" role="status">{msg}</span>}
    </form>
  );
}

export function Preferences({ currency, distanceUnit, fuelUnit }: { userId: string; currency: string; distanceUnit: string; fuelUnit: string }) {
  const router = useRouter();
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
        <div><label className="label" htmlFor="pref-currency">Currency</label>
          <select id="pref-currency" className="select" value={c} onChange={(e) => setC(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div><label className="label" htmlFor="pref-distance">Distance</label>
          <select id="pref-distance" className="select" value={d} onChange={(e) => setD(e.target.value)}>
            <option value="km">km</option><option value="mi">miles</option>
          </select>
        </div>
        <div><label className="label" htmlFor="pref-fuel">Fuel unit</label>
          <select id="pref-fuel" className="select" value={f} onChange={(e) => setF(e.target.value)}>
            <option value="L_PER_100KM">L/100km</option><option value="MPG">MPG</option><option value="KM_PER_L">km/L</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save preferences"}</button>
    </form>
  );
}

export function ChangePassword() {
  const [current, setC] = useState("");
  const [next, setN] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null);
    const r = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    if (r.ok) { setMsg("Password updated"); setC(""); setN(""); }
    else setErr("Failed");
  };
  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
<label className="sr-only" htmlFor="current-password">Current password</label>
      <input id="current-password" className="input" type="password" required placeholder="Current password" value={current} onChange={(e) => setC(e.target.value)} autoComplete="current-password" />
      <label className="sr-only" htmlFor="new-password">New password</label>
      <input id="new-password" className="input" type="password" required minLength={8} placeholder="New password" value={next} onChange={(e) => setN(e.target.value)} autoComplete="new-password" />
      {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      {msg && <p className="text-sm text-emerald-700" role="status">{msg}</p>}
      <button className="btn btn-primary" type="submit">Change password</button>
    </form>
  );
}

export function ExportData() {
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
        Download a CSV of everything you have entered. Rows marked <code>isDemo=true</code> are
        sample data seeded into your account, not entries you typed. Receipt images are not
        included — only their references.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => download("all")} disabled={busy !== null}>
          {busy === "all" ? "Preparing…" : "Download everything"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("vehicles")} disabled={busy !== null}>
          Vehicles
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("fuel")} disabled={busy !== null}>
          Fuel entries
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => download("expenses")} disabled={busy !== null}>
          Expenses
        </button>
      </div>
      {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
    </div>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [confirm, setC] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    setErr("Could not delete your account. Please try again.");
  };
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <p className="text-sm text-charcoal-500">
        This closes your account immediately: your profile name and email address are erased and
        all API keys are revoked. We keep anonymized billing and expense records because tax and
        accounting law requires us to retain financial records — they are no longer linked to you.
      </p>
      <label className="label" htmlFor="delete-confirm">Type DELETE to confirm</label>
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
        {busy ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}

export const SettingsForms = { Profile, Preferences, ChangePassword, ExportData, DeleteAccount };
