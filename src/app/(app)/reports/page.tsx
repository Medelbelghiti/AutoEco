import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, computeDepreciation, projectCost, trueOwnershipCost } from "@/lib/finance";
import { getEntitlements } from "@/lib/plans";
import { canPdfRender } from "@/lib/report-pdf-text";
import { formatDate, formatNumber, intlLocale, translateEnum } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function ReportsPage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const locale = getLocale();
  const t = getT();
  const money = (cents: number, cur: string) => formatMoney(cents, cur, intlLocale(locale));
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }] });

  if (vehicles.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{t("nav.reports")}</h1>
        <p className="text-sm text-charcoal-500 mt-2">{t("reports.empty_body")}</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">{t("common.add_vehicle")}</Link>
      </div>
    );
  }

  const v = vehicles[0];
  const result = await computeVehicleCost(user.id, v.id);

  if (!result.ok) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{t("nav.reports")}</h1>
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">{t("common.mixed_currency_title")}</p>
          <p className="text-sm text-amber-700 mt-1">
            {t("reports.mixed_body", { currencies: Array.from(new Set(result.currencies)).join(", ") })}
          </p>
        </div>
      </div>
    );
  }

  const summary = result.summary;
  const currency = summary.baseCurrency;
  const dep = v.purchasePriceCents ? computeDepreciation({
    purchasePriceCents: v.purchasePriceCents,
    purchaseDate: v.purchaseDate ?? new Date(),
    currentResaleCents: v.estimatedResaleCents,
  }) : null;
  const f12 = projectCost(summary, 12);
  const trueCost = v.purchasePriceCents ? trueOwnershipCost(summary, {
    purchasePriceCents: v.purchasePriceCents,
    purchaseDate: v.purchaseDate ?? new Date(),
    estimatedResaleCents: v.estimatedResaleCents,
    forwardLookingFixedCents: 0,
  }, 36) : null;
  const unit = v.currentMileageUnit ?? "km";

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
      <p className="text-sm text-charcoal-500">
        {v.year} {v.brand} {v.model} · {t("reports.generated", { date: formatDate(locale, new Date()) })}
      </p>

      {ent.enablePdfReports ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* A plain <a>, not next/link: the browser's download handler has to
              run, and a client-side navigation would try to render the PDF. */}
          <a
            href={`/api/reports/ownership-cost?vehicleId=${encodeURIComponent(v.id)}`}
            className="btn btn-accent"
            rel="noopener"
          >
            {t("reports.download_pdf")}
          </a>
          {/* Only a locale whose characters the WinAnsi PDF font cannot carry
              needs this caveat — every other language ships a translated PDF. */}
          {!canPdfRender(locale) && (
            <p className="text-xs text-charcoal-500" role="status">
              {t("reports.pdf_english_warning")}
            </p>
          )}
        </div>
      ) : (
        <div
          className="card border-amber-400 bg-amber-50 text-sm dark:bg-charcoal-900 dark:border-amber-700"
          role="status"
        >
          <p className="font-semibold text-amber-700 dark:text-amber-200">
            {t("reports.pdf_locked_title")}
          </p>
          <p className="mt-1 text-amber-600 dark:text-amber-200/80">
            <Link href="/pricing" className="underline">
              {t("settings.view_plans")}
            </Link>{" "}
            {t("reports.pdf_locked_body")}
          </p>
        </div>
      )}

      <section className="card">
        <p className="font-semibold">{t("reports.summary")}</p>
        <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
          <Row label={t("reports.months_of_data")} value={formatNumber(locale, summary.monthsOfData)} />
          <Row label={t("reports.total_spent")} value={money(summary.totalSpent, currency)} />
          <Row label={t("reports.distance_driven")} value={summary.totalDistance ? `${formatNumber(locale, summary.totalDistance)} ${unit}` : t("common.not_enough_data")} />
          <Row label={t("reports.monthly_average")} value={money(summary.monthlyAverage, currency)} />
          <Row label={t("reports.annual_estimate")} value={money(summary.annualEstimate, currency)} />
          <Row label={t("reports.cost_per_unit", { unit })} value={summary.costPerKm != null ? money(summary.costPerKm, currency) : t("common.not_enough_data")} />
        </div>
        <p className="text-xs text-charcoal-500 mt-3">{t("reports.actual_note")}</p>
      </section>

      <section className="card">
        <p className="font-semibold">{t("reports.by_category")}</p>
        <div className="overflow-x-auto mt-3">
          <table className="basic">
            <thead><tr><th>{t("common.category")}</th><th className="text-end">{t("common.amount")}</th><th className="text-end">%</th></tr></thead>
            <tbody>
              {summary.breakdown.map((b) => (
                <tr key={b.category}><td>{translateEnum(t, "category.", b.category)}</td><td className="text-end">{money(b.amount, currency)}</td><td className="text-end">{b.percent}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <p className="font-semibold">{t("reports.forecast_12")}</p>
        <p className="text-3xl font-extrabold mt-2 text-emerald-700">{money(f12.total, currency)}</p>
        <ul className="text-xs text-charcoal-500 mt-3 space-y-1">
          {f12.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
        </ul>
      </section>

      {dep && (
        <section className="card">
          <p className="font-semibold">{t("reports.depreciation")}</p>
          <p className="text-sm mt-2">{t("reports.method")}: <strong>{dep.method}</strong></p>
          <p className="text-sm">{t("reports.total_depreciation")}: <strong>{money(dep.totalDepreciationCents, currency)}</strong></p>
          <p className="text-xs text-charcoal-500 mt-2">{dep.note}</p>
        </section>
      )}

      {trueCost && (
        <section className="card">
          <p className="font-semibold">{t("reports.true_cost")}</p>
          <p className="text-3xl font-extrabold mt-2">{money(trueCost.total, currency)}</p>
          <ul className="text-xs text-charcoal-500 mt-3 space-y-1">
            {trueCost.breakdown.map((b) => (
              <li key={b.label}><span className="badge badge-info me-2">{b.source}</span>{b.label}: <strong>{money(b.cents, currency)}</strong></li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1 text-xs text-charcoal-400">
            {trueCost.assumptions.map((a, i) => <li key={i}>· {a}</li>)}
          </ul>
        </section>
      )}

      <p className="text-xs text-charcoal-500">
        {t("reports.standing_note")}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-charcoal-500">{label}</p>
      <p className="font-semibold mt-0.5">{value}</p>
    </div>
  );
}
