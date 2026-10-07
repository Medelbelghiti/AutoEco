import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, projectCost } from "@/lib/finance";
import { LineChart, ArrowRight } from "lucide-react";
import { formatNumber, intlLocale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function FinancialTwinPage() {
  const user = await requireUser();
  const locale = getLocale();
  const t = getT();
  const money = (cents: number, currency: string) => formatMoney(cents, currency, intlLocale(locale));
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false } });
  if (vehicles.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{t("nav.financial_twin")}</h1>
        <p className="text-sm text-charcoal-500 mt-2">{t("twin.empty_body")}</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">{t("common.add_vehicle")}</Link>
      </div>
    );
  }

  const rows = await Promise.all(vehicles.map(async (v) => {
    const r = await computeVehicleCost(user.id, v.id);
    return { v, result: r };
  }));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><LineChart className="w-5 h-5 text-emerald-600" /> {t("nav.financial_twin")}</h1>
        <p className="text-sm text-charcoal-500">{t("twin.subtitle")}</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="basic">
          <thead>
            <tr>
              <th>{t("common.vehicle")}</th>
              <th>{t("twin.monthly_actual")}</th>
              <th>{t("dashboard.cost_per_km")}</th>
              <th>{t("dashboard.total_spent")}</th>
              <th>{t("twin.forecast_12")}</th>
              <th>{t("twin.months_of_data")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, result }) => {
              if (!result.ok) {
                return (
                  <tr key={v.id}>
                    <td>{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</td>
                    <td colSpan={5} className="text-amber-700 text-sm">{t("common.mixed_row")}</td>
                    <td><Link href={`/garage/${v.id}`} className="text-xs underline">{t("common.edit")}</Link></td>
                  </tr>
                );
              }
              const s = result.summary;
              const f = projectCost(s, 12);
              return (
                <tr key={v.id}>
                  <td><Link href={`/garage/${v.id}`} className="underline">{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</Link></td>
                  <td>{money(s.monthlyAverage, s.baseCurrency)}</td>
                  <td>{s.costPerKm != null ? money(s.costPerKm, s.baseCurrency) : "—"}</td>
                  <td>{money(s.totalSpent, s.baseCurrency)}</td>
                  <td className="text-emerald-700">{money(f.total, s.baseCurrency)}</td>
                  <td>{formatNumber(locale, s.monthsOfData)}</td>
                  <td><Link href={`/garage/${v.id}`} className="text-xs underline inline-flex items-center gap-1">{t("common.open")} <ArrowRight className="w-3 h-3" /></Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-charcoal-500">
        {t("twin.no_invention")}
      </p>
    </div>
  );
}
