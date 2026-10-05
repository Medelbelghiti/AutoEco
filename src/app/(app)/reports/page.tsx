import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, computeDepreciation, projectCost, trueOwnershipCost } from "@/lib/finance";
import { getEntitlements } from "@/lib/plans";

export default async function ReportsPage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }] });

  if (vehicles.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-charcoal-500 mt-2">Add a vehicle and expenses to generate a report.</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">Add a vehicle</Link>
      </div>
    );
  }

  const v = vehicles[0];
  const result = await computeVehicleCost(user.id, v.id);

  if (!result.ok) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">Mixed-currency data detected</p>
          <p className="text-sm text-amber-700 mt-1">
            Currencies present: {Array.from(new Set(result.currencies)).join(", ")}.
            AutoEco cannot aggregate totals across currencies. Edit your entries to use a single currency to view this report.
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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cost of Ownership Report</h1>
      <p className="text-sm text-charcoal-500">
        {v.year} {v.brand} {v.model} · Generated {new Date().toLocaleDateString()}
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
            Download PDF
          </a>
          {user.locale !== "en" && (
            <p className="text-xs text-charcoal-500" role="status">
              The PDF is generated in English. Characters the PDF font cannot
              represent are transliterated or replaced with "?".
            </p>
          )}
        </div>
      ) : (
        <div
          className="card border-amber-400 bg-amber-50 text-sm dark:bg-charcoal-900 dark:border-amber-700"
          role="status"
        >
          <p className="font-semibold text-amber-700 dark:text-amber-200">
            PDF download is available on Pro and above.
          </p>
          <p className="mt-1 text-amber-600 dark:text-amber-200/80">
            <Link href="/pricing" className="underline">
              View plans
            </Link>{" "}
            to download this report as a PDF. Everything on this page stays free.
          </p>
        </div>
      )}

      <section className="card">
        <p className="font-semibold">Summary</p>
        <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
          <Row label="Months of data" value={String(summary.monthsOfData)} />
          <Row label="Total recorded spending" value={formatMoney(summary.totalSpent, currency)} />
          <Row label="Distance driven" value={summary.totalDistance ? summary.totalDistance.toLocaleString() + " " + (v.currentMileageUnit ?? "km") : "Not enough data"} />
          <Row label="Monthly average" value={formatMoney(summary.monthlyAverage, currency)} />
          <Row label="Estimated annual cost" value={formatMoney(summary.annualEstimate, currency)} />
          <Row label={`Cost per ${v.currentMileageUnit ?? "km"}`} value={summary.costPerKm != null ? formatMoney(summary.costPerKm, currency) : "Not enough data"} />
        </div>
        <p className="text-xs text-charcoal-500 mt-3">Numbers labeled ACTUAL are derived from your recorded expenses and fuel entries.</p>
      </section>

      <section className="card">
        <p className="font-semibold">By category</p>
        <div className="overflow-x-auto mt-3">
          <table className="basic">
            <thead><tr><th>Category</th><th className="text-right">Amount</th><th className="text-right">%</th></tr></thead>
            <tbody>
              {summary.breakdown.map((b) => (
                <tr key={b.category}><td className="capitalize">{b.category}</td><td className="text-right">{formatMoney(b.amount, currency)}</td><td className="text-right">{b.percent}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <p className="font-semibold">Forecast (next 12 months)</p>
        <p className="text-3xl font-extrabold mt-2 text-emerald-700">{formatMoney(f12.total, currency)}</p>
        <ul className="text-xs text-charcoal-500 mt-3 space-y-1">
          {f12.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
        </ul>
      </section>

      {dep && (
        <section className="card">
          <p className="font-semibold">Depreciation (ESTIMATE)</p>
          <p className="text-sm mt-2">Method: <strong>{dep.method}</strong></p>
          <p className="text-sm">Total estimated depreciation: <strong>{formatMoney(dep.totalDepreciationCents, currency)}</strong></p>
          <p className="text-xs text-charcoal-500 mt-2">{dep.note}</p>
        </section>
      )}

      {trueCost && (
        <section className="card">
          <p className="font-semibold">True cost of ownership (3-year horizon)</p>
          <p className="text-3xl font-extrabold mt-2">{formatMoney(trueCost.total, currency)}</p>
          <ul className="text-xs text-charcoal-500 mt-3 space-y-1">
            {trueCost.breakdown.map((b) => (
              <li key={b.label}><span className="badge badge-info mr-2">{b.source}</span>{b.label}: <strong>{formatMoney(b.cents, currency)}</strong></li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1 text-xs text-charcoal-400">
            {trueCost.assumptions.map((a, i) => <li key={i}>· {a}</li>)}
          </ul>
        </section>
      )}

      <p className="text-xs text-charcoal-500">
        All financial outputs in this report are either ACTUAL (from your recorded data), ESTIMATE (calculated from assumptions), or FORECAST (projection into the future).
        AutoEco is a financial analysis tool — not a mechanical or safety diagnostic service.
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
