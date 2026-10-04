"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { track } from "@/lib/track-client";

/**
 * Car cost calculator (public, no signup required).
 *
 * The formula is intentionally simple and fully transparent:
 *
 *   annual fuel   = (km_per_year / 100) * consumption_L_per_100km * price_per_litre
 *   annual total  = fuel + insurance + maintenance + depreciation + (parking * 12) + (tolls * 12)
 *   monthly       = annual total / 12
 *   cost per km   = annual total / km_per_year
 *
 * Everything the visitor types is a USER INPUT. Everything derived from it
 * is a CALCULATED value. Every figure the visitor did not supply is an
 * ASSUMPTION and is labelled as such. We never silently invent a number.
 */

type Currency = "USD" | "EUR" | "GBP" | "CAD" | "MAD";

const CURRENCIES: Record<Currency, { symbol: string; perLitre: number }> = {
  USD: { symbol: "$", perLitre: 1.0 },
  EUR: { symbol: "€", perLitre: 0.92 },
  GBP: { symbol: "£", perLitre: 0.79 },
  CAD: { symbol: "C$", perLitre: 1.36 },
  MAD: { symbol: "MAD ", perLitre: 10.1 },
};

interface Line {
  key: string;
  label: string;
  /** Amount per year in major currency units. */
  annual: number;
  /** How this figure was arrived at. */
  basis: "provided" | "calculated";
  detail: string;
  color: string;
}

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp + round a numeric input, keeping the raw string for the field. */
function safe(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function CarCostCalculator() {
  const uid = useId();

  const [currency, setCurrency] = useState<Currency>("USD");
  const [distance, setDistance] = useState("12000");
  const [consumption, setConsumption] = useState("7.0");
  const [fuelPrice, setFuelPrice] = useState("1.50");
  const [insurance, setInsurance] = useState("900");
  const [maintenance, setMaintenance] = useState("600");
  const [depreciation, setDepreciation] = useState("2000");
  const [parking, setParking] = useState("60");
  const [tolls, setTolls] = useState("30");

  const symbol = CURRENCIES[currency].symbol;

  const r = useMemo(() => {
    const kmYear = safe(num(distance, 0), 0, 2_000_000);
    const l100 = safe(num(consumption, 0), 0, 100);
    const priceL = safe(num(fuelPrice, 0), 0, 1000);

    const ins = safe(num(insurance, 0), 0, 10_000_000);
    const maint = safe(num(maintenance, 0), 0, 10_000_000);
    const depr = safe(num(depreciation, 0), 0, 10_000_000);
    const parkM = safe(num(parking, 0), 0, 1_000_000);
    const tollM = safe(num(tolls, 0), 0, 1_000_000);

    const fuelAnnual = (kmYear / 100) * l100 * priceL;
    const parkAnnual = parkM * 12;
    const tollAnnual = tollM * 12;

    const lines: Line[] = [
      {
        key: "fuel",
        label: "Fuel",
        annual: fuelAnnual,
        basis: "calculated",
        detail: `${kmYear.toLocaleString("en-US")} km ÷ 100 × ${l100} L/100km × ${symbol}${priceL.toFixed(2)}/L`,
        color: "bg-emerald-500",
      },
      {
        key: "insurance",
        label: "Insurance",
        annual: ins,
        basis: "provided",
        detail: `You entered ${symbol}${ins.toLocaleString("en-US")}/year`,
        color: "bg-amber-500",
      },
      {
        key: "maintenance",
        label: "Maintenance",
        annual: maint,
        basis: "provided",
        detail: `You entered ${symbol}${maint.toLocaleString("en-US")}/year`,
        color: "bg-charcoal-700 dark:bg-charcoal-300",
      },
      {
        key: "depreciation",
        label: "Depreciation",
        annual: depr,
        basis: "provided",
        detail: `You entered ${symbol}${depr.toLocaleString("en-US")}/year`,
        color: "bg-rose-500",
      },
      {
        key: "parking",
        label: "Parking",
        annual: parkAnnual,
        basis: "calculated",
        detail: `${symbol}${parkM.toLocaleString("en-US")}/month × 12`,
        color: "bg-sky-500",
      },
      {
        key: "tolls",
        label: "Tolls",
        annual: tollAnnual,
        basis: "calculated",
        detail: `${symbol}${tollM.toLocaleString("en-US")}/month × 12`,
        color: "bg-violet-500",
      },
      {
        key: "other",
        label: "Other (tax, tyres, repairs, charging…)",
        annual: 0,
        basis: "provided",
        detail: "Not included in this quick estimate",
        color: "bg-charcoal-400",
      },
    ];

    const annualTotal = lines.reduce((s, l) => s + l.annual, 0);
    const monthly = annualTotal / 12;
    const costPerKm = kmYear > 0 ? annualTotal / kmYear : null;

    // Largest category first, as in the in-app reports.
    const ranked = [...lines]
      .filter((l) => l.annual > 0)
      .sort((a, b) => b.annual - a.annual)
      .map((l) => ({ ...l, pct: annualTotal > 0 ? (l.annual / annualTotal) * 100 : 0 }));

    return { kmYear, l100, priceL, lines, annualTotal, monthly, costPerKm, ranked };
  }, [distance, consumption, fuelPrice, insurance, maintenance, depreciation, parking, tolls, symbol]);

  const money = (n: number) =>
    `${symbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const problems: string[] = [];
  if (r.kmYear <= 0) problems.push("Enter your annual distance so cost per kilometer can be calculated.");
  if (r.l100 <= 0) problems.push("Enter your fuel consumption (L/100km).");
  if (r.priceL <= 0) problems.push("Enter the fuel price you actually pay per litre.");
  if (r.annualTotal <= 0) problems.push("Fill in at least one cost so there is something to total up.");

  // --- Funnel analytics -------------------------------------------------
  // Fires once when the visitor first changes an input (they engaged), and
  // once when the result becomes usable (all required inputs valid).
  // No field VALUE is ever sent — only the fact that they interacted.
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    if (problems.length > 0 || completedRef.current) return;
    completedRef.current = true;
    track("calculator_completed");
  }, [problems.length]);

  const markStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    track("calculator_started");
  };

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-start">
      {/* ------------------------------ Inputs ------------------------------ */}
      <form className="card space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
        <div>
          <h2 className="font-semibold">Your numbers</h2>
          <p className="text-sm text-charcoal-500 mt-1">
            Everything you enter is a real figure from your own records. We do not substitute
            averages for your data.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field id={`${uid}-distance`} label="Annual distance" unit="km / year">
            <input
              id={`${uid}-distance`}
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={2000000}
              step={100}
              value={distance}
              onChange={(e) => { markStarted(); setDistance(e.target.value); }}
              aria-describedby={`${uid}-distance-help`}
            />
            <Help id={`${uid}-distance-help`}>Your odometer reading a year ago vs today.</Help>
          </Field>

          <Field id={`${uid}-currency`} label="Currency">
            <select
              id={`${uid}-currency`}
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {(Object.keys(CURRENCIES) as Currency[]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field id={`${uid}-consumption`} label="Consumption" unit="L / 100km">
            <input
              id={`${uid}-consumption`}
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.1"
              value={consumption}
              onChange={(e) => { markStarted(); setConsumption(e.target.value); }}
            />
          </Field>

          <Field id={`${uid}-fuelprice`} label="Fuel price" unit={`${symbol}per litre`}>
            <input
              id={`${uid}-fuelprice`}
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={fuelPrice}
              onChange={(e) => { markStarted(); setFuelPrice(e.target.value); }}
            />
          </Field>
        </div>

        <fieldset className="border-t border-charcoal-200 dark:border-charcoal-700 pt-4">
          <legend className="label">Running costs you pay directly</legend>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            <Field id={`${uid}-insurance`} label="Insurance" unit="per year">
              <input
                id={`${uid}-insurance`}
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="10"
                value={insurance}
                onChange={(e) => { markStarted(); setInsurance(e.target.value); }}
              />
            </Field>
            <Field id={`${uid}-maintenance`} label="Maintenance & repairs" unit="per year">
              <input
                id={`${uid}-maintenance`}
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="10"
                value={maintenance}
                onChange={(e) => { markStarted(); setMaintenance(e.target.value); }}
              />
            </Field>
            <Field id={`${uid}-depreciation`} label="Depreciation" unit="per year">
              <input
                id={`${uid}-depreciation`}
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="50"
                value={depreciation}
                onChange={(e) => { markStarted(); setDepreciation(e.target.value); }}
              />
            </Field>
            <Field id={`${uid}-parking`} label="Parking" unit="per month">
              <input
                id={`${uid}-parking`}
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="5"
                value={parking}
                onChange={(e) => { markStarted(); setParking(e.target.value); }}
              />
            </Field>
            <Field id={`${uid}-tolls`} label="Tolls & congestion charges" unit="per month">
              <input
                id={`${uid}-tolls`}
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="5"
                value={tolls}
                onChange={(e) => { markStarted(); setTolls(e.target.value); }}
              />
            </Field>
          </div>
        </fieldset>

        {problems.length > 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 p-3" role="alert">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Check these</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-amber-700 dark:text-amber-200/80 space-y-0.5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-charcoal-200 dark:border-charcoal-700 pt-4">
          <button
            type="button"
            className="btn btn-secondary text-sm"
            onClick={() => {
              setDistance("12000");
              setConsumption("7.0");
              setFuelPrice("1.50");
              setInsurance("900");
              setMaintenance("600");
              setDepreciation("2000");
              setParking("60");
              setTolls("30");
            }}
          >
            Reset to example
          </button>
        </div>
      </form>

      {/* ------------------------------ Results ----------------------------- */}
      <div className="space-y-4 lg:sticky lg:top-24">
        <div className="card bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
          <p className="label">Your estimated cost</p>
          <p className="text-4xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">
            {money(r.monthly)}
            <span className="text-base font-semibold text-charcoal-600 dark:text-charcoal-300">/month</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <Result label="Per year" value={money(r.annualTotal)} />
            <Result
              label="Per kilometer"
              value={r.costPerKm == null ? "—" : `${symbol}${r.costPerKm.toFixed(3)}`}
              hint={r.costPerKm == null ? "needs annual distance" : undefined}
            />
            <Result label="Annual distance" value={`${r.kmYear.toLocaleString("en-US")} km`} />
            <Result label="Currency" value={currency} />
          </dl>
        </div>

        <div className="card">
          <h3 className="font-semibold">Where the money goes</h3>
          <p className="text-xs text-charcoal-500 mt-1">Share of your {money(r.annualTotal)} annual total.</p>

          {r.ranked.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-4">
              Enter your costs to see the breakdown.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {r.ranked.map((l) => (
                <li key={l.key}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{l.label}</span>
                    <span className="text-charcoal-600 dark:text-charcoal-300 tabular-nums">
                      {money(l.annual)}
                      <span className="text-charcoal-400"> · {l.pct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="progress mt-1" role="img" aria-label={`${l.label}: ${l.pct.toFixed(1)}% of annual cost`}>
                    <span className={l.color} style={{ width: `${Math.max(1, l.pct)}%` }} />
                  </div>
                  <p className="text-xs text-charcoal-500 mt-1">
                    {l.detail}
                    {l.basis === "calculated" && (
                      <span className="ml-1 badge badge-info align-middle">Calculated from your inputs</span>
                    )}
                    {l.basis === "provided" && (
                      <span className="ml-1 badge badge-info align-middle">Your figure</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="card">
          <summary className="font-semibold cursor-pointer select-none">Assumptions &amp; limits</summary>
          <ul className="mt-3 space-y-1.5 text-sm text-charcoal-600 dark:text-charcoal-300 list-disc pl-5">
            <li>Fuel is the only calculated line: distance ÷ 100 × L/100km × price per litre.</li>
            <li>
              Parking and tolls are entered per month and multiplied by 12. Insurance, maintenance and
              depreciation are entered per year.
            </li>
            <li>
              <strong>Not included:</strong> road tax, insurance excess, tyres, servicing plans,
              EV charging, fines, financing interest, or resale value at end of ownership.
            </li>
            <li>Depreciation uses your figure rather than a trade-in estimate, so it stays honest.</li>
            <li>Cost per kilometer is undefined with zero annual distance.</li>
            <li>
              This is an estimate from the numbers you supplied — not a quote, valuation or financial
              advice.
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  unit,
  children,
}: {
  id: string;
  label: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {unit && <span className="normal-case font-normal tracking-normal text-charcoal-400"> ({unit})</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Help({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-charcoal-500">
      {children}
    </p>
  );
}

function Result({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white/70 dark:bg-charcoal-900/50 p-3">
      <dt className="text-xs text-charcoal-500">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
      {hint && <p className="text-[11px] text-charcoal-500">{hint}</p>}
    </div>
  );
}