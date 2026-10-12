import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney, projectCost } from "@/lib/finance";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatNumber, intlLocale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function InsightsPage() {
  const user = await requireUser();
  const locale = getLocale();
  const t = getT();
  const money = (cents: number, currency: string) => formatMoney(cents, currency, intlLocale(locale));
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }] });
  if (vehicles.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{t("nav.insights")}</h1>
        <p className="text-sm text-charcoal-500 mt-2">{t("common.no_vehicles")}</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">{t("common.add_vehicle")}</Link>
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
  const primaryName = primary.v.nickname ?? `${primary.v.year} ${primary.v.brand} ${primary.v.model}`;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold">{t("nav.insights")}</h1>
      <p className="text-sm text-charcoal-500">{t("insights.subtitle")}</p>

      {!summary && (
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">{t("common.mixed_currency_title")}</p>
          <p className="text-sm text-amber-700 mt-1">{t("insights.mixed_body")}</p>
        </div>
      )}

      {summary && (
        <section className="card mt-6">
          <p className="font-semibold">{t("insights.monthly_spending", { vehicle: primaryName })}</p>
          {sortedMonths.length === 0 ? (
            <p className="text-sm text-charcoal-500 mt-2">{t("insights.not_enough")}</p>
          ) : (
            <div className="mt-4 flex items-end gap-1 h-32">
              {sortedMonths.map((m) => {
                const h = Math.round((monthly[m] / max) * 100);
                return (
                  <div key={m} className="flex-1 flex flex-col items-center gap-1" title={`${m}: ${money(monthly[m], currency)}`}>
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
          <p className="font-semibold">{t("insights.forecast_vs_actual")}</p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>{t("insights.monthly_average")}: <strong>{money(summary.monthlyAverage, currency)}</strong></li>
            <li>{t("insights.forecast_12")}: <strong>{money(f12.total, currency)}</strong></li>
            <li>{t("common.distance")}: <strong>{summary.totalDistance != null ? formatNumber(locale, summary.totalDistance) : "—"} {primary.v.currentMileageUnit ?? "km"}</strong></li>
            <li>{t("dashboard.cost_per_km")}: <strong>{summary.costPerKm != null ? money(summary.costPerKm, currency) : "—"}</strong></li>
          </ul>
          <p className="text-xs text-charcoal-500 mt-3">{t("insights.assumption", { list: f12.assumptions.join(" · ") })}</p>
        </section>
      )}

      <section className="card mt-6">
        <p className="font-semibold">{t("insights.all_vehicles")}</p>
        <div className="overflow-x-auto mt-3">
          <table className="basic">
            <thead>
              <tr>
                <th>{t("common.vehicle")}</th>
                <th>{t("dashboard.monthly_cost")}</th>
                <th>{t("dashboard.cost_per_km")}</th>
                <th>{t("dashboard.total_spent")}</th>
                <th>{t("dashboard.annual_estimate")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map(({ v, result }) => {
                if (!result.ok) {
                  return (
                    <tr key={v.id}>
                      <td><Link className="underline" href={`/garage/${v.id}`}>{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</Link></td>
                      <td colSpan={4} className="text-amber-700 text-xs">{t("insights.mixed_row")}</td>
                    </tr>
                  );
                }
                const s = result.summary;
                return (
                  <tr key={v.id}>
                    <td><Link className="underline" href={`/garage/${v.id}`}>{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</Link></td>
                    <td>{money(s.monthlyAverage, s.baseCurrency)}</td>
                    <td>{s.costPerKm != null ? money(s.costPerKm, s.baseCurrency) : "—"}</td>
                    <td>{money(s.totalSpent, s.baseCurrency)}</td>
                    <td>{money(s.annualEstimate, s.baseCurrency)}</td>
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
