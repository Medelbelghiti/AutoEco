"use client";
import { useState } from "react";

export function Client() {
  const [price, setPrice] = useState(25000);
  const [years, setYears] = useState(5);

  const rows = [];
  let v = price;
  for (let y = 1; y <= years; y++) {
    const d = v * 0.2;
    v = Math.max(0, v - d);
    rows.push({ year: y, value: v, depreciation: d });
  }
  const totalDep = price - v;
  return (
    <div className="card mt-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Purchase price</label><input className="input" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></div>
        <div><label className="label">Years</label><input className="input" type="number" min={1} max={30} value={years} onChange={(e) => setYears(Number(e.target.value))} /></div>
      </div>
<div className="overflow-x-auto">
        <table className="basic">
          <thead><tr><th>Year</th><th>Estimated value</th><th>Annual depreciation</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}><td>{r.year}</td><td>${r.value.toFixed(2)}</td><td>${r.depreciation.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">Total estimated depreciation after {years} years: <strong>${totalDep.toFixed(2)}</strong> ({Math.round((totalDep / price) * 100)}% of purchase price)</p>
      <p className="text-xs text-charcoal-500">Straight-line 20% per year estimate. Real depreciation depends on the model, mileage, condition, and market.</p>
    </div>
  );
}
