/**
 * /share?token=… — PUBLIC cost-of-ownership report.
 *
 * This route deliberately lives OUTSIDE the `(app)` route group. It used to
 * sit inside it, and because `(app)/layout.tsx` redirects unauthenticated
 * visitors to `/login`, a shared link was unusable: the recipient — who by
 * definition has no AutoEco account — could never open the report. That
 * silently disabled the paid `enableShareableReports` feature.
 *
 * Security model: the unguessable `ShareLink.token` is the only credential.
 * No personal data is rendered (no name, email, or account identifiers) and
 * the owner can revoke access at any time, which flips `revokedAt`.
 */
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, computeDepreciation, projectCost } from "@/lib/finance";

export const metadata: Metadata = {
  title: "Cost of Ownership Report",
  description: "A shared AutoEco cost-of-ownership report. Financial estimates only.",
  // Shared links must never be indexed.
  robots: { index: false, follow: false },
};

export default async function SharePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token;
  if (!token || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    return (
      <Frame>
        <Error msg="This link is missing an invalid token. Ask the owner to resend it." />
      </Frame>
    );
  }
  return (
    <Frame>
      <PublicReport token={token} />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-charcoal-50 dark:bg-charcoal-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">{children}</div>
      <footer className="max-w-3xl mx-auto px-4 sm:px-6 pb-10 text-xs text-charcoal-500">
        Shared from{" "}
        <a href="/" className="underline">
          AutoEco
        </a>{" "}
        — financial estimates, not vehicle safety or mechanical diagnosis.
      </footer>
    </div>
  );
}

async function PublicReport({ token }: { token: string }) {
  const link = await db.shareLink.findUnique({ where: { token } });
  if (!link || link.revokedAt) return <Error msg="This share link has been revoked." />;
  if (link.expiresAt && link.expiresAt < new Date())
    return <Error msg="This share link has expired." />;

  const vehicles = await db.vehicle.findMany({
    where: { userId: link.userId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
  });
  const primary = vehicles[0];
  if (!primary) return <Error msg="No vehicle data available." />;

  const result = await computeVehicleCost(link.userId, primary.id);
  if (!result.ok) {
    return (
      <Error msg="Owner data is temporarily unavailable or contains mixed currencies." />
    );
  }
  const summary = result.summary;
  // CRITICAL: use the financial summary's authoritative base currency, NOT
  // vehicle.purchaseCurrency (which can differ from the actual recorded data).
  const currency = summary.baseCurrency;
  const dep = primary.purchasePriceCents
    ? computeDepreciation({
        purchasePriceCents: primary.purchasePriceCents,
        purchaseDate: primary.purchaseDate ?? new Date(),
        currentResaleCents: primary.estimatedResaleCents,
      })
    : null;
  const f12 = projectCost(summary, 12);

  return (
    <div>
      <p className="text-xs text-charcoal-500">Public share — no personal information exposed.</p>
      <h1 className="text-2xl font-bold mt-2">Cost of Ownership Report</h1>
      <p className="text-sm text-charcoal-500">
        {primary.year} {primary.brand} {primary.model}
      </p>

      <section className="card mt-6">
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <Row label="Months of data" value={String(summary.monthsOfData)} />
          <Row label="Total spending" value={formatMoney(summary.totalSpent, currency)} />
          <Row
            label="Monthly average"
            value={formatMoney(summary.monthlyAverage, currency)}
            accent
          />
          <Row
            label="Annual estimate"
            value={formatMoney(summary.annualEstimate, currency)}
          />
        </div>
      </section>

      <section className="card mt-4">
        <p className="font-semibold">By category</p>
        <div className="overflow-x-auto mt-3">
          <table className="basic">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Amount</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {summary.breakdown.map((b) => (
                <tr key={b.category}>
                  <td className="capitalize">{b.category}</td>
                  <td className="text-right">{formatMoney(b.amount, currency)}</td>
                  <td className="text-right">{b.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card mt-4">
        <p className="font-semibold">12-month forecast (flat, FORECAST)</p>
        <p className="text-3xl font-extrabold mt-2 text-emerald-700">
          {formatMoney(f12.total, currency)}
        </p>
        <ul className="text-xs text-charcoal-500 mt-3 space-y-1">
          {f12.assumptions.map((a, i) => (
            <li key={i}>- {a}</li>
          ))}
        </ul>
      </section>

      {dep && (
        <section className="card mt-4">
          <p className="font-semibold">Depreciation (ESTIMATE)</p>
          <p className="text-sm mt-2">
            Method: <strong>{dep.method}</strong>
          </p>
          <p className="text-sm">
            Total estimated depreciation:{" "}
            <strong>{formatMoney(dep.totalDepreciationCents, currency)}</strong>
          </p>
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-charcoal-500">{label}</p>
      <p className={"font-semibold mt-0.5 " + (accent ? "text-emerald-700" : "")}>{value}</p>
    </div>
  );
}

function Error({ msg }: { msg: string }) {
  return (
    <div className="max-w-md mx-auto py-16 text-center">
      <p className="text-lg font-semibold">Link unavailable</p>
      <p className="text-sm text-charcoal-500 mt-2">{msg}</p>
    </div>
  );
}