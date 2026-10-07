import Link from "next/link";
import { Car, Fuel, Receipt, LineChart, Sparkles, ChevronRight, FileText, Camera } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { getMonthlyUsage } from "@/lib/usage";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, type CostSummary } from "@/lib/finance";
import { formatDate, formatNumber, intlLocale, translateEnum } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/server-i18n";

export default async function DashboardPage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const usage = await getMonthlyUsage(user.id);
  const locale = getLocale();
  const t = getT();
  // Money groups and decimals follow the interface language; the currency is
  // always the one the account is set to, never one implied by the locale.
  const money = (cents: number, currency: string) => formatMoney(cents, currency, intlLocale(locale));

  const vehicles = await db.vehicle.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
  });

  const primary = vehicles.find((v) => v.isPrimary) ?? vehicles[0];

  let summary = null as CostSummary | null;
  let mixedCurrency: string[] | null = null;
  if (primary) {
    const result = await computeVehicleCost(user.id, primary.id);
    if (result.ok) summary = result.summary;
    else if (result.error === "mixed_currency") mixedCurrency = result.currencies;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{user.name ? t("dashboard.welcome_named", { name: user.name }) : t("dashboard.welcome")}</h1>
          <p className="text-sm text-charcoal-500">
            {t("settings.plan")}: <strong>{ent.planName}</strong>
            {ent.isTrial && ent.trialEndsAt && ` · ${t("dashboard.trial_ends", { date: formatDate(locale, ent.trialEndsAt) })}`}
            {ent.currentPeriodEnd && !ent.isTrial && ` · ${t("dashboard.renews", { date: formatDate(locale, ent.currentPeriodEnd) })}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/expenses/new" className="btn btn-primary"><Receipt className="w-4 h-4" /> {t("common.add_expense")}</Link>
          <Link href="/garage/new" className="btn btn-accent"><Car className="w-4 h-4" /> {t("common.add_vehicle")}</Link>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className="mt-8 card text-center py-16">
          <Car className="w-12 h-12 text-charcoal-300 mx-auto" />
          <p className="mt-3 font-semibold">{t("dashboard.empty_title")}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("dashboard.empty_body")}</p>
          <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">{t("dashboard.empty_cta")}</Link>
        </div>
      ) : (
        <>
          {mixedCurrency && (
            <div className="mt-6 card border-amber-300 bg-amber-50">
              <p className="font-semibold text-amber-800">{t("common.mixed_currency_title")}</p>
              <p className="text-sm text-amber-700 mt-1">
                {t("common.mixed_currency_body", {
                  currencies: Array.from(new Set(mixedCurrency)).join(", "),
                  vehicle: primary?.nickname ?? `${primary?.year ?? ""} ${primary?.brand ?? ""} ${primary?.model ?? ""}`.trim(),
                })}
              </p>
            </div>
          )}

          <div className="mt-6 grid md:grid-cols-4 gap-3">
            <KPI label={t("nav.garage")} value={formatNumber(locale, vehicles.length)} />
            <KPI label={t("dashboard.expenses_month")} value={formatNumber(locale, usage.expenses)} sub={t("common.of_limit", { limit: formatNumber(locale, ent.maxExpensesPerMonth) })} />
            <KPI label={t("dashboard.ai_chats")} value={formatNumber(locale, usage.aiConversations)} sub={t("common.of_limit", { limit: formatNumber(locale, ent.aiConversationsPerMonth) })} />
            <KPI label={t("dashboard.forecast_horizon")} value={t("common.months_short", { count: ent.forecastHorizonMonths })} />
          </div>

          {primary && summary && (
            <section className="mt-6 card">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="label">{t("dashboard.primary_vehicle")}</p>
                  <h2 className="text-xl font-bold mt-1">{primary.nickname ?? `${primary.year} ${primary.brand} ${primary.model}`}</h2>
                  <p className="text-xs text-charcoal-500">{primary.fuelType} · {primary.transmission ?? "—"} · {primary.fuelEconomyText ?? "—"}</p>
                </div>
                <Link href={`/garage/${primary.id}`} className="btn btn-secondary text-sm">{t("dashboard.view_vehicle")} <ChevronRight className="w-4 h-4" /></Link>
              </div>
              <div className="mt-5 grid md:grid-cols-4 gap-3">
                <KPI label={t("dashboard.monthly_cost")} value={money(summary.monthlyAverage, summary.baseCurrency)} accent />
                <KPI label={t("dashboard.cost_per_km")} value={summary.costPerKm != null ? money(summary.costPerKm, summary.baseCurrency) : "—"} />
                <KPI label={t("dashboard.total_spent")} value={money(summary.totalSpent, summary.baseCurrency)} />
                <KPI label={t("dashboard.annual_estimate")} value={money(summary.annualEstimate, summary.baseCurrency)} />
              </div>
              {summary.breakdown.length > 0 && (
                <div className="mt-5">
                  <p className="label mb-2">{t("dashboard.where_money")}</p>
                  {summary.breakdown.slice(0, 6).map((b) => (
                    <div key={b.category} className="mb-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="capitalize">{translateEnum(t, "category.", b.category)}</span>
                        <span className="text-charcoal-500">{money(b.amount, summary.baseCurrency)} · {b.percent}%</span>
                      </div>
                      <div className="progress"><span className="bg-emerald-500" style={{ width: `${b.percent}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="badge badge-info">{t("dashboard.badge_actual", { count: formatNumber(locale, summary.monthsOfData) })}</span>
                <span className="badge badge-info">{t("dashboard.badge_distance", { value: summary.totalDistance != null ? formatNumber(locale, summary.totalDistance) : "—", unit: primary.currentMileageUnit ?? "km" })}</span>
                {summary.missingDistance && <span className="badge badge-warn">{t("dashboard.no_distance")}</span>}
              </div>
            </section>
          )}

          <div className="mt-6 grid md:grid-cols-3 lg:grid-cols-5 gap-3">
            <QuickAction href="/fuel" icon={Fuel} title={t("nav.fuel")} desc={t("dashboard.qa_fuel")} />
            <QuickAction href="/receipts" icon={Camera} title={t("nav.receipts")} desc={t("dashboard.qa_receipts")} />
            <QuickAction href="/insights" icon={LineChart} title={t("nav.insights")} desc={t("dashboard.qa_insights")} />
            <QuickAction href="/assistant" icon={Sparkles} title={t("nav.assistant")} desc={t("dashboard.qa_assistant")} />
            <QuickAction href="/reports" icon={FileText} title={t("nav.reports")} desc={t("dashboard.qa_reports")} />
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`card ${accent ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200/60 dark:border-emerald-700/40" : ""}`}>
      <p className="label">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? "text-emerald-700 dark:text-emerald-300" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-charcoal-500 mt-1">{sub}</p>}
    </div>
  );
}

function QuickAction({ href, icon: Icon, title, desc }: { href: string; icon: any; title: string; desc: string }) {
  return (
    <Link href={href} className="card hover:shadow-elevated transition">
      <Icon className="w-5 h-5 text-emerald-600" />
      <p className="font-semibold mt-2">{title}</p>
      <p className="text-sm text-charcoal-500">{desc}</p>
    </Link>
  );
}
