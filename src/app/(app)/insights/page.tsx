import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney, projectCost } from "@/lib/finance";
import { computeVehicleCost } from "@/lib/compute-cost";

export default async function InsightsPage() {
  const user = await requireUser();
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }] });
  if (vehicles.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-sm text-charcoal-500 mt-2">No vehicles yet.</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">Add a vehicle</Link>
      </div>
    );
  }
  const data = await Promise.all(vehicles.map(async (v) => {
    const result = await computeVehicleCost(user.id, v.id);
    const expenses = await db.expense.findMany({ where: { vehicleId: v.id }, select: { date: true, amountCents: true, currency: true }, orderBy: { date: "asc" } });
    return { v, result, expenses };
  }));

  // Pick a primary that successfully produced a summary
  const primary = data.find((d) => d.result.ok) ?? data[0];
  const monthly: Record<string, number> = {};
  if (primary.result.ok) {
    for (const e of primary.expenses) {
      const key = e.date.toISOString().slice(0, 7);
      monthly[key] = (monthly[key] ?? 0) + e.amountCents;
    }
  }
  const sortedMonths = Object.keys(monthly).sort();
  const max = Math.max(1, ...Object.values(monthly));
  const summary = primary.result.ok ? primary.result.summary : null;
  const f12 = summary ? projectCost(summary, 12) : null;
  const currency = summary?.baseCurrency ?? primary.v.purchaseCurrency ?? "USD";

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Insights</h1>
      <p className="text-sm text-charcoal-500">Spending trends and forecasts across your vehicles.</p>

      {!summary && (
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">Mixed-currency data detected</p>
          <p className="text-sm text-amber-700 mt-1">Insights cannot aggregate totals across currencies. Edit your entries to use a single currency.</p>
        </div>
      )}

      {summary && (
        <section className="card mt-6">
          <p className="font-semibold">Monthly spending — {primary.v.nickname ?? `${primary.v.year} ${primary.v.brand} ${primary.v.model}`}</p>
          {sortedMonths.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-2">Not enough data yet. Add expenses to see trends.</p>
          ) : (
            <div className="mt-4 flex items-end gap-1 h-32">
              {sortedMonths.map((m) => {
                const h = Math.round((monthly[m] / max) * 100);
                return (
                  <div key={m} className="flex-1 flex flex-col items-center gap-1" title={`${m}: ${formatMoney(monthly[m], currency)}`}>
                    <div className="w-full bg-emerald-500 rounded-t" style={{ height: `${h}%` }} />
                    <span className="text-[10px] text-charcoal-500 -rotate-45 origin-top-left">{m.slice(2)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {summary && f12 && (
        <section className="card mt-6">
          <p className="font-semibold">Forecast vs actual (12 months)</p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>Monthly average: <strong>{formatMoney(summary.monthlyAverage, currency)}</strong></li>
            <li>12-month forecast (flat): <strong>{formatMoney(f12.total, currency)}</strong></li>
            <li>Distance: <strong>{summary.totalDistance?.toLocaleString() ?? "—"} {primary.v.currentMileageUnit ?? "km"}</strong></li>
            <li>Cost/km: <strong>{summary.costPerKm != null ? formatMoney(summary.costPerKm, currency) : "—"}</strong></li>
          </ul>
          <p className="text-xs text-charcoal-500 mt-3">Assumption: {f12.assumptions.join(" · ")}</p>
        </section>
      )}

      <section className="card mt-6">
        <p className="font-semibold">All vehicles</p>
        <div className="overflow-x-auto mt-3">
          <table className="basic">
            <thead><tr><th>Vehicle</th><th>Monthly</th><th>Cost/km</th><th>Total spent</th><th>Annual est.</th></tr></thead>
            <tbody>
              {data.map(({ v, result }) => {
                if (!result.ok) {
                  return (
                    <tr key={v.id}>
                      <td><Link className="underline" href={`/garage/${v.id}`}>{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</Link></td>
                      <td colSpan={4} className="text-amber-700 text-xs">Mixed-currency data — cannot aggregate.</td>
                    </tr>
                  );
                }
                const s = result.summary;
                return (
                  <tr key={v.id}>
                    <td><Link className="underline" href={`/garage/${v.id}`}>{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</Link></td>
                    <td>{formatMoney(s.monthlyAverage, s.baseCurrency)}</td>
                    <td>{s.costPerKm != null ? formatMoney(s.costPerKm, s.baseCurrency) : "—"}</td>
                    <td>{formatMoney(s.totalSpent, s.baseCurrency)}</td>
                    <td>{formatMoney(s.annualEstimate, s.baseCurrency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
