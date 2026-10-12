import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import ScenarioForm from "./ScenarioForm";
import { formatDate } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function ScenariosPage() {
  const user = await requireUser();
  const locale = getLocale();
  const t = getT();
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ isPrimary: "desc" }] });

  if (vehicles.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{t("nav.scenarios")}</h1>
        <p className="text-sm text-charcoal-500 mt-2">{t("scenarios.empty_body")}</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">{t("common.add_vehicle")}</Link>
      </div>
    );
  }

  const primary = vehicles[0];
  const result = await computeVehicleCost(user.id, primary.id);
  const saved = await db.scenario.findMany({ where: { userId: user.id, vehicleId: primary.id }, orderBy: { createdAt: "desc" }, take: 10 });

  if (!result.ok) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{t("nav.scenarios")}</h1>
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">{t("common.mixed_currency_title")}</p>
          <p className="text-sm text-amber-700 mt-1">{t("scenarios.mixed_body")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold">{t("nav.scenarios")}</h1>
      <p className="text-sm text-charcoal-500">{t("scenarios.subtitle")}</p>
      <ScenarioForm summary={result.summary} vehicle={primary} />
      {saved.length > 0 && (
        <div className="card mt-6">
          <p className="font-semibold">{t("scenarios.saved")}</p>
          <ul className="mt-3 space-y-2 text-sm">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                <span>{s.name} - {s.type}</span>
                <span className="text-xs text-charcoal-500">{formatDate(locale, s.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
