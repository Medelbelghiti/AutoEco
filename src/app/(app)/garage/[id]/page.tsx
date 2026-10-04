import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, computeDepreciation, projectCost, trueOwnershipCost } from "@/lib/finance";
import { ArrowLeft } from "lucide-react";

export default async function VehicleDetail({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const vehicle = await db.vehicle.findUnique({ where: { id: params.id } });
  if (!vehicle) notFound();
  assertOwnership(vehicle.userId, user);

  const result = await computeVehicleCost(user.id, vehicle.id);

  if (!result.ok && result.error === "mixed_currency") {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Link href="/garage" className="text-sm text-charcoal-500 inline-flex items-center gap-1 mb-2"><ArrowLeft className="w-4 h-4" /> Back to garage</Link>
        <h1 className="text-2xl font-bold mt-2">{vehicle.year} {vehicle.brand} {vehicle.model}</h1>
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">Mixed-currency data</p>
          <p className="text-sm text-amber-700 mt-1">Currencies present: {Array.from(new Set(result.currencies)).join(", ")}. AutoEco cannot aggregate totals across currencies. Edit your entries to use a single currency.</p>
        </div>
      </div>
    );
  }

  const summary = result.ok ? result.summary : null;
  const currency = summary?.baseCurrency ?? vehicle.purchaseCurrency ?? "USD";
  const [expenses, fuel] = await Promise.all([
    db.expense.findMany({ where: { vehicleId: vehicle.id }, orderBy: { date: "desc" }, take: 50 }),
    db.fuelEntry.findMany({ where: { vehicleId: vehicle.id }, orderBy: { date: "desc" }, take: 30 }),
  ]);

  const dep = vehicle.purchasePriceCents ? computeDepreciation({
    purchasePriceCents: vehicle.purchasePriceCents,
    purchaseDate: vehicle.purchaseDate ?? new Date(),
    currentResaleCents: vehicle.estimatedResaleCents,
  }) : null;

  const f12 = summary ? projectCost(summary, 12) : null;
  const trueCost = summary && vehicle.purchasePriceCents ? trueOwnershipCost(summary, {
    purchasePriceCents: vehicle.purchasePriceCents,
    purchaseDate: vehicle.purchaseDate ?? new Date(),
    estimatedResaleCents: vehicle.estimatedResaleCents,
    forwardLookingFixedCents: 0,
  }, 36) : null;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <Link href="/garage" className="text-sm text-charcoal-500 inline-flex items-center gap-1 mb-2"><ArrowLeft className="w-4 h-4" /> Back to garage</Link>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="label">{vehicle.nickname ?? "Vehicle"}</p>
          <h1 className="text-2xl font-bold mt-1">{vehicle.year} {vehicle.brand} {vehicle.model}</h1>
          <p className="text-sm text-charcoal-500">{vehicle.trim ?? "—"} · {vehicle.fuelType} · {vehicle.transmission ?? "—"}</p>
        </div>
        {vehicle.isDemo && <span className="badge badge-info">Sample data</span>}
      </div>

      {summary && (
        <>
          <div className="mt-6 grid md:grid-cols-4 gap-3">
            <KPI label="Monthly cost" value={formatMoney(summary.monthlyAverage, currency)} accent />
            <KPI label="Cost / km" value={summary.costPerKm != null ? formatMoney(summary.costPerKm, currency) : "—"} />
            <KPI label="Total spent" value={formatMoney(summary.totalSpent, currency)} />
            <KPI label="Annual estimate" value={formatMoney(summary.annualEstimate, currency)} />
          </div>

          <section className="mt-6 card">
            <p className="font-semibold mb-3">Financial Twin</p>
            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <Stat label="12-month forecast" value={f12 ? formatMoney(f12.total, currency) : "—"} note="ACTUAL + projected flat" />
              <Stat label="36-month forecast" value={f12 ? formatMoney(projectCost(summary, 36).total, currency) : "—"} note="ACTUAL + projected flat" />
              {dep && <Stat label="Depreciation" value={formatMoney(dep.totalDepreciationCents, currency)} note={dep.method === "user-provided" ? "user-provided" : "20% / yr estimate"} />}
            </div>
            {trueCost && (
              <div className="mt-4 pt-4 border-t border-charcoal-200">
                <p className="text-xs text-charcoal-500 mb-2">Total cost of ownership (forecast, 36 months)</p>
                <p className="text-3xl font-bold">{formatMoney(trueCost.total, currency)}</p>
                <ul className="mt-3 space-y-1 text-xs text-charcoal-500">
                  {trueCost.breakdown.map((b) => (
                    <li key={b.label} className="flex justify-between">
                      <span>
                        <span className="badge badge-info mr-2">{b.source}</span>
                        {b.label}
                      </span>
                      <span>{formatMoney(b.cents, currency)}</span>
                    </li>
                  ))}
                </ul>
                <ul className="mt-2 space-y-1 text-xs text-charcoal-400">
                  {trueCost.assumptions.map((a, i) => <li key={i}>· {a}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="mt-6 card">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Where the money goes</p>
              <Link href="/scenarios" className="btn btn-secondary text-sm">Run a scenario</Link>
            </div>
            {summary.breakdown.length > 0 && (
              <div className="mt-3">
                {summary.breakdown.slice(0, 6).map((b) => (
                  <div key={b.category} className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{b.category}</span>
                      <span className="text-charcoal-500">{formatMoney(b.amount, currency)} · {b.percent}%</span>
                    </div>
                    <div className="progress"><span className="bg-emerald-500" style={{ width: `${b.percent}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="badge badge-info">Actual: {summary.monthsOfData} months</span>
              <span className="badge badge-info">Distance: {summary.totalDistance?.toLocaleString() ?? "—"} {vehicle.currentMileageUnit ?? "km"}</span>
              {summary.missingDistance && <span className="badge badge-warn">No distance data</span>}
            </div>
          </section>
        </>
      )}

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <section className="card">
          <p className="font-semibold">Recent expenses</p>
          {expenses.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-2">No expenses yet.</p>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="basic">
                <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Mileage</th></tr></thead>
                <tbody>
                  {expenses.slice(0, 8).map((e) => (
                    <tr key={e.id}>
                      <td>{e.date.toISOString().slice(0, 10)}</td>
                      <td className="capitalize">{e.category}</td>
                      <td>{formatMoney(e.amountCents, e.currency)}</td>
                      <td>{e.mileage?.toLocaleString() ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/expenses" className="text-sm text-emerald-700 dark:text-emerald-400 underline mt-2 inline-block">All expenses →</Link>
        </section>

        <section className="card">
          <p className="font-semibold">Recent fuel entries</p>
          {fuel.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-2">No fuel entries yet.</p>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="basic">
                <thead><tr><th>Date</th><th>Liters</th><th>Amount</th><th>Consumption</th></tr></thead>
                <tbody>
                  {fuel.slice(0, 8).map((f) => (
                    <tr key={f.id}>
                      <td>{f.date.toISOString().slice(0, 10)}</td>
                      <td>{f.liters?.toFixed(2) ?? "—"}</td>
                      <td>{formatMoney(f.amountCents, f.currency)}</td>
                      <td>{f.consumption ? `${f.consumption} L/100km` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/fuel" className="text-sm text-emerald-700 dark:text-emerald-400 underline mt-2 inline-block">All fuel entries →</Link>
        </section>
      </div>
    </div>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card ${accent ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200/60 dark:border-emerald-700/40" : ""}`}>
      <p className="label">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? "text-emerald-700 dark:text-emerald-300" : ""}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="p-3 rounded-lg bg-charcoal-50 dark:bg-charcoal-800/60">
      <p className="text-xs text-charcoal-500">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
      {note && <p className="text-xs text-charcoal-400 mt-1">{note}</p>}
    </div>
  );
}
