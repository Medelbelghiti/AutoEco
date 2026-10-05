import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { getTripSummaries } from "@/lib/trips-queries";
import { deductionCentsForTrip, type TripDistanceUnit, type TripPurpose } from "@/lib/trips";
import { TripRowActions } from "@/components/trips/TripRowActions";

export const dynamic = "force-dynamic";

/** Matches the cap in GET /api/trips. */
const TRIP_PAGE_SIZE = 500;

const PURPOSE_LABELS: Record<TripPurpose, string> = {
  business: "Business",
  personal: "Personal",
  commute: "Commute",
  medical: "Medical",
  charity: "Charity",
  other: "Other",
};

function formatDistance(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()} ${unit}`;
}

function formatMoney(cents: number | null, currency: string): string {
  // `null` means the trip has no rate recorded, which is different from zero.
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function TripsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const uid = user.id;

  const [trips, summary, vehicles, ent] = await Promise.all([
    db.trip.findMany({
      where: { userId: uid },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: { vehicle: { select: { nickname: true, brand: true, model: true } } },
    }),
    getTripSummaries(uid),
    db.vehicle.findMany({
      where: { userId: uid },
      orderBy: { createdAt: "desc" },
      select: { id: true, nickname: true, brand: true, model: true, year: true },
    }),
    getEntitlements(user),
  ]);

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return "Unknown vehicle";
    return v.nickname ?? [v.year, v.brand, v.model].filter(Boolean).join(" ");
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trips</h1>
          <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-1">
            Log distances you drove, and see what each year adds up to.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/export?dataset=trips"
            className="px-3 py-2 rounded-lg border border-charcoal-300 dark:border-charcoal-700 text-sm font-medium hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
          >
            Export CSV
          </a>
          <Link
            href="/trips/new"
            className="px-3 py-2 rounded-lg bg-charcoal-900 dark:bg-white text-white dark:text-charcoal-900 text-sm font-medium"
          >
            Add trip
          </Link>
        </div>
      </header>

      {vehicles.length === 0 ? (
        <div className="rounded-xl border border-charcoal-200 dark:border-charcoal-800 p-6 text-center">
          <p className="font-medium">Add a vehicle first</p>
          <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-1">
            Every trip belongs to a vehicle, so trips need one to exist.
          </p>
          <Link
            href="/garage/new"
            className="inline-block mt-4 px-3 py-2 rounded-lg bg-charcoal-900 dark:bg-white text-white dark:text-charcoal-900 text-sm font-medium"
          >
            Add vehicle
          </Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="summary-heading" className="space-y-3">
            <h2 id="summary-heading" className="text-lg font-semibold">
              By year
            </h2>
            {summary.summaries.length === 0 ? (
              <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
                Nothing logged yet. Your yearly totals appear here once you add a trip.
              </p>
            ) : (
              [...summary.summaries].reverse().map((s) => (
                <article
                  key={s.year}
                  className="rounded-xl border border-charcoal-200 dark:border-charcoal-800 bg-white dark:bg-charcoal-900 p-4"
                >
                  <h3 className="font-semibold">{s.year}</h3>
                  <p className="text-xs text-charcoal-600 dark:text-charcoal-400 mt-0.5">
                    {s.tripCount} trip{s.tripCount === 1 ? "" : "s"}
                  </p>

                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {Object.entries(s.distance).map(([unit, value]) => (
                      <div key={unit}>
                        <dt className="text-xs uppercase tracking-wide text-charcoal-500 dark:text-charcoal-400">
                          Distance
                        </dt>
                        <dd className="text-lg font-semibold">
                          {formatDistance(value, unit)}
                        </dd>
                      </div>
                    ))}
                    {s.deductions.map((d) => (
                      <div key={`${d.currency}:${d.rateCentsPerUnit}:${d.unit}`}>
                        <dt className="text-xs uppercase tracking-wide text-charcoal-500 dark:text-charcoal-400">
                          Deduction at {formatMoney(d.rateCentsPerUnit, d.currency)}/{d.unit}
                        </dt>
                        <dd className="text-lg font-semibold">
                          {formatMoney(d.amountCents, d.currency)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {s.byPurpose.length > 0 && (
                    <ul className="mt-4 pt-3 border-t border-charcoal-100 dark:border-charcoal-800 space-y-1 text-sm">
                      {s.byPurpose.map((p) => (
                        <li key={p.purpose} className="flex justify-between gap-3">
                          <span className="text-charcoal-600 dark:text-charcoal-400">
                            {PURPOSE_LABELS[p.purpose as TripPurpose]}
                          </span>
                          <span className="tabular-nums">
                            {p.tripCount} trip{p.tripCount === 1 ? "" : "s"}
                            {Object.entries(p.distance)
                              .map(([unit, value]) => ` · ${formatDistance(value, unit)}`)
                              .join("")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))
            )}

            {!summary.hasDeductionRate && (
              <p className="text-sm text-charcoal-600 dark:text-charcoal-400 rounded-xl border border-charcoal-200 dark:border-charcoal-800 p-4">
                You have not set a deduction rate, so no deduction totals are shown.{" "}
                <Link href="/settings" className="underline font-medium">
                  Set one in Settings
                </Link>{" "}
                and it will be recorded with each trip you log.
              </p>
            )}
          </section>

          {ent.maxTripsPerMonth > 0 && (
            <p className="text-xs text-charcoal-500 dark:text-charcoal-400">
              Your plan allows {ent.maxTripsPerMonth} new trips per month.
            </p>
          )}

          <section aria-labelledby="log-heading" className="space-y-3">
            <h2 id="log-heading" className="text-lg font-semibold">
              Log
            </h2>
            {trips.length === 0 ? (
              <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
                No trips yet.
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-200 dark:divide-charcoal-800 rounded-xl border border-charcoal-200 dark:border-charcoal-800 bg-white dark:bg-charcoal-900">
                {trips.map((t) => {
                  const amount = deductionCentsForTrip(t);
                  return (
                    <li key={t.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {PURPOSE_LABELS[t.purpose as TripPurpose]}
                          {t.distance !== null && (
                            <span className="font-normal text-charcoal-600 dark:text-charcoal-400">
                              {" · "}
                              {formatDistance(t.distance, t.distanceUnit as TripDistanceUnit)}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-0.5">
                          {t.date.toISOString().slice(0, 10)} · {vehicleName(t.vehicleId)}
                        </p>
                        {(t.startOdometer !== null || t.note) && (
                          <p className="text-sm text-charcoal-500 dark:text-charcoal-500 mt-1">
                            {t.startOdometer !== null && (
                              <>Odometer {t.startOdometer.toLocaleString()} </>
                            )}
                            {t.note ? ` · ${t.note}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {t.deductionRateCents !== null && t.deductionCurrency && (
                          <p className="text-sm tabular-nums">
                            {formatMoney(amount, t.deductionCurrency)}
                          </p>
                        )}
                        <TripRowActions tripId={t.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {trips.length === TRIP_PAGE_SIZE && (
              // The list is capped for page weight. Saying so beats letting
              // somebody believe their whole log fits on one screen.
              <p className="text-xs text-charcoal-600 dark:text-charcoal-400">
                Showing the {TRIP_PAGE_SIZE} most recent trips. Export the CSV for the
                complete log.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}