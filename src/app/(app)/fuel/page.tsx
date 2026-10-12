import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/finance";
import { formatNumber, intlLocale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function FuelPage() {
  const user = await requireUser();
  const locale = getLocale();
  const t = getT();
  const entries = await db.fuelEntry.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 200,
    include: { vehicle: true },
  });

  const withConsumption = entries.filter((e) => e.consumption != null);
  const avgConsumption = withConsumption.reduce((acc, e) => acc + (e.consumption ?? 0), 0) / Math.max(1, withConsumption.length);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.fuel")}</h1>
          <p className="text-sm text-charcoal-500">
            {avgConsumption
              ? t("fuel.avg_consumption", { value: avgConsumption.toFixed(2) })
              : t("fuel.not_enough")}
          </p>
        </div>
        <Link href="/fuel/new" className="btn btn-accent"><Plus className="w-4 h-4" /> {t("common.add_fuel")}</Link>
      </div>

      {entries.length === 0 ? (
        <div className="mt-8 card text-center py-16">
          <p className="font-semibold">{t("fuel.empty_title")}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("fuel.empty_body")}</p>
          <Link href="/fuel/new" className="btn btn-accent mt-4 inline-flex">{t("common.add_fuel")}</Link>
        </div>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="basic">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("common.vehicle")}</th>
                <th>{t("fuel.liters")}</th>
                <th>{t("common.amount")}</th>
                <th>{t("common.mileage")}</th>
                <th>{t("fuel.consumption")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.date.toISOString().slice(0, 10)}</td>
                  <td>{e.vehicle.nickname ?? `${e.vehicle.year} ${e.vehicle.brand} ${e.vehicle.model}`}</td>
                  <td>{e.liters?.toFixed(2) ?? "—"}</td>
                  <td>{formatMoney(e.amountCents, e.currency, intlLocale(locale))}</td>
                  <td>{formatNumber(locale, e.mileage)} {e.mileageUnit}</td>
                  <td>{e.consumption ? `${e.consumption.toFixed(2)} L/100km` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
