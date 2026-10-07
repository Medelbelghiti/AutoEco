import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { getTripSummaries } from "@/lib/trips-queries";
import { deductionCentsForTrip, type TripDistanceUnit } from "@/lib/trips";
import { formatNumber, intlLocale, plural, translateEnum } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";
import { TripRowActions } from "@/components/trips/TripRowActions";
import { formatMoney } from "@/lib/finance";

export const dynamic = "force-dynamic";

/** Matches the cap in GET /api/trips. */
const TRIP_PAGE_SIZE = 500;

export default async function TripsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const uid = user.id;
  const locale = getLocale();
  const t = getT();
  const money = (cents: number | null, ccy: string) =>
    cents === null ? "—" : formatMoney(cents, ccy, intlLocale(locale));
  const fmt = (value: number) => formatNumber(locale, value);
  const dist = (value: number, unit: string) => `${fmt(Math.round(value * 10) / 10)} ${unit}`;
  const tripCount = (count: number) =>
    plural(locale, count, t("trips.trip_count_one", { count }), t("trips.trip_count_other", { count }));

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

  const purposeLabel = (purpose: string) => translateEnum(t, "trips.purpose_", purpose);

  const vehicleName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return t("trips.unknown_vehicle");
    return v.nickname ?? [v.year, v.brand, v.model].filter(Boolean).join(" ");
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.trips")}</h1>
          <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-1">
            {t("trips.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/export?dataset=trips"
            className="px-3 py-2 rounded-lg border border-charcoal-300 dark:border-charcoal-700 text-sm font-medium hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
          >
            {t("trips.export_csv")}
          </a>
          <Link
            href="/trips/new"
            className="px-3 py-2 rounded-lg bg-charcoal-900 dark:bg-white text-white dark:text-charcoal-900 text-sm font-medium"
          >
            {t("nav.add_trip")}
          </Link>
        </div>
      </header>

      {vehicles.length === 0 ? (
        <div className="rounded-xl border border-charcoal-200 dark:border-charcoal-800 p-6 text-center">
          <p className="font-medium">{t("trips.needs_vehicle_title")}</p>
          <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-1">
            {t("trips.needs_vehicle_body")}
          </p>
          <Link
            href="/garage/new"
            className="inline-block mt-4 px-3 py-2 rounded-lg bg-charcoal-900 dark:bg-white text-white dark:text-charcoal-900 text-sm font-medium"
          >
            {t("common.add_vehicle")}
          </Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="summary-heading" className="space-y-3">
            <h2 id="summary-heading" className="text-lg font-semibold">
              {t("trips.by_year")}
            </h2>
            {summary.summaries.length === 0 ? (
              <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
                {t("trips.empty_year")}
              </p>
            ) : (
              [...summary.summaries].reverse().map((s) => (
                <article
                  key={s.year}
                  className="rounded-xl border border-charcoal-200 dark:border-charcoal-800 bg-white dark:bg-charcoal-900 p-4"
                >
                  <h3 className="font-semibold">{s.year}</h3>
                  <p className="text-xs text-charcoal-600 dark:text-charcoal-400 mt-0.5">
                    {tripCount(s.tripCount)}
                  </p>

                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {Object.entries(s.distance).map(([unit, value]) => (
                      <div key={unit}>
                        <dt className="text-xs uppercase tracking-wide text-charcoal-500 dark:text-charcoal-400">
                          {t("common.distance")}
                        </dt>
                        <dd className="text-lg font-semibold">
                          {dist(value, unit)}
                        </dd>
                      </div>
                    ))}
                    {s.deductions.map((d) => (
                      <div key={`${d.currency}:${d.rateCentsPerUnit}:${d.unit}`}>
                        <dt className="text-xs uppercase tracking-wide text-charcoal-500 dark:text-charcoal-400">
                          {t("trips.deduction_at", { rate: money(d.rateCentsPerUnit, d.currency), unit: d.unit })}
                        </dt>
                        <dd className="text-lg font-semibold">
                          {money(d.amountCents, d.currency)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {s.byPurpose.length > 0 && (
                    <ul className="mt-4 pt-3 border-t border-charcoal-100 dark:border-charcoal-800 space-y-1 text-sm">
                      {s.byPurpose.map((p) => (
                        <li key={p.purpose} className="flex justify-between gap-3">
                          <span className="text-charcoal-600 dark:text-charcoal-400">
                            {purposeLabel(p.purpose)}
                          </span>
                          <span className="tabular-nums">
                            {tripCount(p.tripCount)}
                            {Object.entries(p.distance)
                              .map(([unit, value]) => ` · ${dist(value, unit)}`)
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
                {t("trips.no_deduction_rate")}{" "}
                <Link href="/settings" className="underline font-medium">
                  {t("trips.set_in_settings")}
                </Link>{" "}
                {t("trips.rate_recorded_note")}
              </p>
            )}
          </section>

          {ent.maxTripsPerMonth > 0 && (
            <p className="text-xs text-charcoal-500 dark:text-charcoal-400">
              {t("trips.plan_allowance", { count: ent.maxTripsPerMonth })}
            </p>
          )}

          <section aria-labelledby="log-heading" className="space-y-3">
            <h2 id="log-heading" className="text-lg font-semibold">
              {t("trips.log")}
            </h2>
            {trips.length === 0 ? (
              <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
                {t("trips.empty_log")}
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-200 dark:divide-charcoal-800 rounded-xl border border-charcoal-200 dark:border-charcoal-800 bg-white dark:bg-charcoal-900">
                {trips.map((trip) => {
                  const amount = deductionCentsForTrip(trip);
                  return (
                    <li key={trip.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {purposeLabel(trip.purpose)}
                          {trip.distance !== null && (
                            <span className="font-normal text-charcoal-600 dark:text-charcoal-400">
                              {" · "}
                              {dist(trip.distance, trip.distanceUnit as TripDistanceUnit)}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-0.5">
                          {trip.date.toISOString().slice(0, 10)} · {vehicleName(trip.vehicleId)}
                        </p>
                        {(trip.startOdometer !== null || trip.note) && (
                          <p className="text-sm text-charcoal-500 dark:text-charcoal-500 mt-1">
                            {trip.startOdometer !== null && (
                              <>{t("trips.odometer_start", { value: fmt(trip.startOdometer) })} </> 
                            )}
                            {trip.note ? ` · ${trip.note}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {trip.deductionRateCents !== null && trip.deductionCurrency && (
                          <p className="text-sm tabular-nums">
                            {money(amount, trip.deductionCurrency)}
                          </p>
                        )}
                        <TripRowActions tripId={trip.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {trips.length === TRIP_PAGE_SIZE && (
              <p className="text-xs text-charcoal-600 dark:text-charcoal-400">
                {t("trips.showing_page", { count: fmt(TRIP_PAGE_SIZE) })}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}