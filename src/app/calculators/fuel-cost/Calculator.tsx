"use client";
import { useState } from "react";

export function FuelCalculatorClient() {
  const [km, setKm] = useState(12000);
  const [consumption, setC] = useState(7);
  const [price, setP] = useState(1.5);
  const fuel = (km / 100) * consumption * price;
  return (
    <div className="card mt-6 space-y-3">
      <div><label className="label">Annual km</label><input className="input" type="number" value={km} onChange={(e) => setKm(Number(e.target.value))} /></div>
      <div><label className="label">Consumption (L/100km)</label><input className="input" type="number" step="0.1" value={consumption} onChange={(e) => setC(Number(e.target.value))} /></div>
      <div><label className="label">Fuel price</label><input className="input" type="number" step="0.01" value={price} onChange={(e) => setP(Number(e.target.value))} /></div>
      <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
        <p className="text-sm text-charcoal-500">Estimated annual fuel cost</p>
        <p className="text-3xl font-bold text-emerald-700">${fuel.toFixed(2)}</p>
        <p className="text-sm text-charcoal-500 mt-1">Per month: ${(fuel / 12).toFixed(2)}</p>
      </div>
    </div>
  );
}
