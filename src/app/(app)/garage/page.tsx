import Link from "next/link";
import { Car, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney } from "@/lib/finance";
import { formatNumber, intlLocale } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function GaragePage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const locale = getLocale();
  const t = getT();
  const money = (cents: number, currency: string) => formatMoney(cents, currency, intlLocale(locale));
  const vehicles = await db.vehicle.findMany({
    where: { userId: user.id },
    orderBy: [{ archived: "asc" }, { isPrimary: "desc" }, { createdAt: "desc" }],
  });
  const cards = await Promise.all(
    vehicles.map(async (v) => ({ v, result: await computeVehicleCost(user.id, v.id) }))
  );
  const activeCount = vehicles.filter((v) => !v.archived).length;
  const canAdd = activeCount < ent.maxVehicles;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("garage.title")}</h1>
          <p className="text-sm text-charcoal-500">
            {t("garage.plan_usage", {
              used: formatNumber(locale, activeCount),
              max: formatNumber(locale, ent.maxVehicles),
              plan: ent.planName,
            })}
          </p>
        </div>
        <Link href={canAdd ? "/garage/new" : "/pricing"} className={`btn ${canAdd ? "btn-accent" : "btn-secondary"}`}>
          <Plus className="w-4 h-4" /> {t("common.add_vehicle")}
        </Link>
      </div>
      {vehicles.length === 0 ? (
        <div className="mt-8 card text-center py-16">
          <Car className="w-12 h-12 text-charcoal-300 mx-auto" />
          <p className="mt-3 font-semibold">{t("garage.empty_title")}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("garage.empty_body")}</p>
          <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">{t("garage.empty_cta")}</Link>
        </div>
      ) : (
        <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(({ v, result }) => (
            <Link key={v.id} href={`/garage/${v.id}`} className="card hover:shadow-elevated transition">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold">{v.nickname ?? `${v.year} ${v.brand} ${v.model}`}</p>
                  <p className="text-xs text-charcoal-500">{v.trim ?? "—"} · {v.fuelType}</p>
                </div>
                {v.isPrimary && <span className="badge badge-ok">{t("garage.primary")}</span>}
                {v.archived && <span className="badge badge-info">{t("garage.archived")}</span>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="bg-charcoal-50 dark:bg-charcoal-800/60 p-2 rounded-md">
                  <p className="text-xs text-charcoal-500">{t("dashboard.monthly_cost")}</p>
                  <p className="font-bold">
                    {result.ok ? money(result.summary.monthlyAverage, result.summary.baseCurrency) : "—"}
                  </p>
                </div>
                <div className="bg-charcoal-50 dark:bg-charcoal-800/60 p-2 rounded-md">
                  <p className="text-xs text-charcoal-500">{t("garage.cost_per", { unit: v.currentMileageUnit ?? "km" })}</p>
                  <p className="font-bold">
                    {result.ok && result.summary.costPerKm != null
                      ? money(result.summary.costPerKm, result.summary.baseCurrency)
                      : "—"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-charcoal-500">
                <span>{v.currentMileage != null ? formatNumber(locale, v.currentMileage) : "—"} {v.currentMileageUnit ?? "km"}</span>
                <span>·</span>
                <span>{v.purchaseDate ? new Date(v.purchaseDate).getFullYear() : "—"}</span>
              </div>
              {!result.ok && (
                <p className="mt-2 text-xs text-amber-700">{t("garage.mixed_hidden")}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
