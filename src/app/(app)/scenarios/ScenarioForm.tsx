"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sliders } from "lucide-react";
import { formatMoney, type CostSummary } from "@/lib/finance";

interface Props { summary: CostSummary; vehicle: { id: string; purchasePriceCents: number | null; purchaseCurrency: string | null; estimatedResaleCents: number | null }; }

export default function ScenarioForm({ summary, vehicle }: Props) {
  const router = useRouter();
  const [fuelDelta, setFuelDelta] = useState(0);
  const [horizon, setHorizon] = useState(36);
  const [replacePrice, setReplacePrice] = useState(25000);
  const [result, setResult] = useState<null | { keep: number; replace: number; diff: number; assumptions: string[] }>(null);
  const currency = vehicle.purchaseCurrency ?? "USD";

  const run = () => {
    const baseMonthly = summary.monthlyAverage;
    const fuelShare = summary.totalFuel / Math.max(1, summary.totalSpent);
    const projectedMonthly = Math.round(baseMonthly * (1 + (fuelDelta / 100) * fuelShare));
    const keepTotal = projectedMonthly * horizon;
    const assumptions = [
      "Base monthly cost (ACTUAL): " + formatMoney(baseMonthly, currency),
      "Fuel share (ACTUAL): " + Math.round(fuelShare * 100) + "%",
      "Fuel price delta applied to fuel share: " + (fuelDelta >= 0 ? "+" : "") + fuelDelta + "%",
      "Horizon: " + horizon + " months",
    ];
    let replaceTotal = 0;
    if (replacePrice > 0) {
      const resale = vehicle.estimatedResaleCents ?? (vehicle.purchasePriceCents ? Math.round(vehicle.purchasePriceCents * 0.5) : 0);
      replaceTotal = replacePrice * 100 - resale + projectedMonthly * horizon;
      assumptions.push("Current resale (ESTIMATE): " + formatMoney(resale, currency));
      assumptions.push("Replacement price (USER INPUT): " + formatMoney(replacePrice * 100, currency));
      assumptions.push("Operating cost of replacement assumed equal (heuristic)");
    }
    setResult({ keep: keepTotal, replace: replaceTotal, diff: replaceTotal - keepTotal, assumptions });
  };

  const save = async () => {
    if (!result) return;
    await fetch("/api/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId: vehicle.id,
        name: "Scenario " + new Date().toLocaleString(),
        type: "keep_vs_replace",
        inputs: { fuelDelta, horizon, replacePrice: replacePrice * 100 },
        outputs: result,
      }),
    });
    router.refresh();
  };

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2"><Sliders className="w-5 h-5 text-emerald-600" /><p className="font-semibold">Run a What-If scenario</p></div>
      <div className="mt-4 grid md:grid-cols-2 gap-3">
        <div><label className="label">Fuel price change (%)</label><input className="input" type="number" value={fuelDelta} onChange={(e) => setFuelDelta(Number(e.target.value))} /></div>
        <div><label className="label">Horizon (months)</label><input className="input" type="number" min={1} max={120} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} /></div>
        <div><label className="label">Replacement vehicle price</label><input className="input" type="number" value={replacePrice} onChange={(e) => setReplacePrice(Number(e.target.value))} /></div>
      </div>
      <button onClick={run} className="btn btn-accent mt-4">Run scenario</button>
      {result && (
        <div className="mt-4 p-4 rounded-lg bg-charcoal-50 dark:bg-charcoal-800/60">
          <p className="text-sm">Keep current car: <strong>{formatMoney(result.keep, currency)}</strong></p>
          {result.replace > 0 && (<p className="text-sm mt-1">Replace with new: <strong>{formatMoney(result.replace, currency)}</strong></p>)}
          {result.replace > 0 && (<p className="text-sm mt-1">Difference: <strong className={result.diff > 0 ? "text-rose-600" : "text-emerald-700"}>{formatMoney(Math.abs(result.diff), currency)} {result.diff > 0 ? "more expensive to replace" : "cheaper to replace"}</strong></p>)}
          <ul className="mt-3 text-xs text-charcoal-500 space-y-1">{result.assumptions.map((a, i) => <li key={i}>- {a}</li>)}</ul>
          <button onClick={save} className="btn btn-secondary text-sm mt-3">Save scenario</button>
        </div>
      )}
    </div>
  );
}
