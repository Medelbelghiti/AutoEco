"use client";

import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Defaults { currency: string; distanceUnit: string; fuelUnit: string; }

export function OnboardingForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [currency, setCurrency] = useState(defaults.currency);
  const [distanceUnit, setDistanceUnit] = useState(defaults.distanceUnit);
  const [fuelUnit, setFuelUnit] = useState(defaults.fuelUnit);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    document.cookie = "lg_locale=en; path=/; max-age=" + 60 * 60 * 24 * 365;
    await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency, distanceUnit, fuelUnit }) });
    setBusy(false);
    router.push("/garage/new");
  };

  return (
    <div className="card mt-6">
      {step === 1 && (
        <div>
          <p className="label">Step 1 / 3 — Currency</p>
          <select className="select mt-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
          <button onClick={() => setStep(2)} className="btn btn-primary mt-3">Continue</button>
        </div>
      )}
      {step === 2 && (
        <div>
          <p className="label">Step 2 / 3 — Distance unit</p>
          <select className="select mt-2" value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value)}>
            <option value="km">Kilometers</option>
            <option value="mi">Miles</option>
          </select>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setStep(1)} className="btn btn-secondary">Back</button>
            <button onClick={() => setStep(3)} className="btn btn-primary">Continue</button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div>
          <p className="label">Step 3 / 3 — Fuel unit</p>
          <select className="select mt-2" value={fuelUnit} onChange={(e) => setFuelUnit(e.target.value)}>
            <option value="L_PER_100KM">L / 100 km</option>
            <option value="MPG">MPG (US gallons)</option>
            <option value="KM_PER_L">km / L</option>
          </select>
          <p className="text-sm text-charcoal-500 mt-3">Next: add your first vehicle.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setStep(2)} className="btn btn-secondary">Back</button>
            <button onClick={save} disabled={busy} className="btn btn-accent">{busy ? "Saving..." : "Save and add vehicle"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
