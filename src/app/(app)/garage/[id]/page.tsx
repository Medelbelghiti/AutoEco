import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, computeDepreciation, projectCost, trueOwnershipCost } from "@/lib/finance";
import { formatNumber, intlLocale, translateEnum } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";
import { ArrowLeft } from "lucide-react";

export default async function VehicleDetail({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const locale = getLocale();
  const t = getT();
  const vehicle = await db.vehicle.findUnique({ where: { id: params.id } });
  if (!vehicle) notFound();
  assertOwnership(vehicle.userId, user);

  const result = await computeVehicleCost(user.id, vehicle.id);

  if (!result.ok && result.error === "mixed_currency") {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Link href="/garage" className="text-sm text-charcoal-500 inline-flex items-center gap-1 mb-2"><ArrowLeft className="w-4 h-4" /> {t("garage.back")}</Link>
        <h1 className="text-2xl font-bold mt-2">{vehicle.year} {vehicle.brand} {vehicle.model}</h1>
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">{t("common.mixed_currency_title")}</p>
          <p className="text-sm text-amber-700 mt-1">{t("garage.mixed_body", { currencies: Array.from(new Set(result.currencies)).join(", ") })}</p>
        </div>
      </div>
    );
  }

  const summary = result.ok ? result.summary : null;
  const currency = summary?.baseCurrency ?? vehicle.purchaseCurrency ?? "USD";
  const money = (cents: number, ccy: string) => formatMoney(cents, ccy, intlLocale(locale));
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
      <Link href="/garage" className="text-sm text-charcoal-500 inline-flex items-center gap-1 mb-2"><ArrowLeft className="w-4 h-4" /> {t("garage.back")}</Link>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="label">{vehicle.nickname ?? t("common.vehicle")}</p>
          <h1 className="text-2xl font-bold mt-1">{vehicle.year} {vehicle.brand} {vehicle.model}</h1>
          <p className="text-sm text-charcoal-500">{vehicle.trim ?? "—"} · {vehicle.fuelType} · {vehicle.transmission ?? "—"}</p>
        </div>
        {vehicle.isDemo && <span className="badge badge-info">{t("preview.sample")}</span>}
      </div>

      {summary && (
        <>
          <div className="mt-6 grid md:grid-cols-4 gap-3">
            <KPI label={t("dashboard.monthly_cost")} value={money(summary.monthlyAverage, currency)} accent />
            <KPI label={t("dashboard.cost_per_km")} value={summary.costPerKm != null ? money(summary.costPerKm, currency) : "—"} />
            <KPI label={t("dashboard.total_spent")} value={money(summary.totalSpent, currency)} />
            <KPI label={t("dashboard.annual_estimate")} value={money(summary.annualEstimate, currency)} />
          </div>

          <section className="mt-6 card">
            <p className="font-semibold mb-3">{t("nav.financial_twin")}</p>
            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <Stat label={t("twin.forecast_12")} value={f12 ? money(f12.total, currency) : "—"} note={t("twin.forecast_flat_note")} />
              <Stat label={t("twin.forecast_36")} value={f12 ? money(projectCost(summary, 36).total, currency) : "—"} note={t("twin.forecast_flat_note")} />
              {dep && <Stat label={t("twin.depreciation")} value={money(dep.totalDepreciationCents, currency)} note={dep.method === "user-provided" ? t("twin.depreciation_method_user") : t("twin.depreciation_method_estimate")} />}
            </div>
            {trueCost && (
              <div className="mt-4 pt-4 border-t border-charcoal-200">
                <p className="text-xs text-charcoal-500 mb-2">{t("twin.true_cost_36")}</p>
                <p className="text-3xl font-bold">{money(trueCost.total, currency)}</p>
                <ul className="mt-3 space-y-1 text-xs text-charcoal-500">
                  {trueCost.breakdown.map((b) => (
                    <li key={b.label} className="flex justify-between">
                      <span>
                        <span className="badge badge-info mr-2">{b.source}</span>
                        {b.label}
                      </span>
                      <span>{money(b.cents, currency)}</span>
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
              <p className="font-semibold">{t("dashboard.where_money")}</p>
              <Link href="/scenarios" className="btn btn-secondary text-sm">{t("common.run_scenario")}</Link>
            </div>
            {summary.breakdown.length > 0 && (
              <div className="mt-3">
                {summary.breakdown.slice(0, 6).map((b) => (
                  <div key={b.category} className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{translateEnum(t, "category.", b.category)}</span>
                      <span className="text-charcoal-500">{money(b.amount, currency)} · {b.percent}%</span>
                    </div>
                    <div className="progress"><span className="bg-emerald-500" style={{ width: `${b.percent}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="badge badge-info">{t("twin.actual_months", { count: summary.monthsOfData })}</span>
              <span className="badge badge-info">{t("twin.distance_badge", { distance: summary.totalDistance != null ? formatNumber(locale, summary.totalDistance) : "—", unit: vehicle.currentMileageUnit ?? "km" })}</span>
              {summary.missingDistance && <span className="badge badge-warn">{t("dashboard.no_distance")}</span>}
            </div>
          </section>
        </>
      )}

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <section className="card">
          <p className="font-semibold">{t("expenses.recent")}</p>
          {expenses.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-2">{t("expenses.empty_title")}.</p>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="basic">
                <thead><tr><th>{t("common.date")}</th><th>{t("common.category")}</th><th>{t("common.amount")}</th><th>{t("common.mileage")}</th></tr></thead>
                <tbody>
                  {expenses.slice(0, 8).map((e) => (
                    <tr key={e.id}>
                      <td>{e.date.toISOString().slice(0, 10)}</td>
                      <td className="capitalize">{translateEnum(t, "category.", e.category)}</td>
                      <td>{money(e.amountCents, e.currency)}</td>
                      <td>{e.mileage != null ? formatNumber(locale, e.mileage) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/expenses" className="text-sm text-emerald-700 dark:text-emerald-400 underline mt-2 inline-block">{t("expenses.all")} →</Link>
        </section>

        <section className="card">
          <p className="font-semibold">{t("fuel.recent")}</p>
          {fuel.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-2">{t("fuel.empty_title")}.</p>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="basic">
                <thead><tr><th>{t("common.date")}</th><th>{t("common.liters")}</th><th>{t("common.amount")}</th><th>{t("fuel.consumption")}</th></tr></thead>
                <tbody>
                  {fuel.slice(0, 8).map((f) => (
                    <tr key={f.id}>
                      <td>{f.date.toISOString().slice(0, 10)}</td>
                      <td>{f.liters?.toFixed(2) ?? "—"}</td>
                      <td>{money(f.amountCents, f.currency)}</td>
                      <td>{f.consumption ? `${f.consumption} L/100km` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/fuel" className="text-sm text-emerald-700 dark:text-emerald-400 underline mt-2 inline-block">{t("fuel.all")} →</Link>
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