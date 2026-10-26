import Link from "next/link";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/MarketingShell";
import { TrackEvent } from "@/components/TrackEvent";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getT } from "@/lib/server-i18n";
import { getEntitlements, COMING_SOON_FEATURES } from "@/lib/plans";
import { paypalConfigured, paypalSdkClientId, lifetimePriceMinor, lifetimeCurrency } from "@/lib/paypal";
import { lifetimeGrantAvailable } from "@/lib/paypal-billing";
import { pageMeta } from "@/lib/seo";
import { LifetimeOfferCard } from "@/components/LifetimeOfferCard";
import { lifetimeOfferPriceLabel, lifetimeOfferState } from "@/lib/lifetime-offer";

export const metadata = pageMeta({
  title: "Pricing",
  description:
    "AutoEco plans: start free with one vehicle, then get a one-time Pro (lifetime) upgrade for cost-per-kilometer tracking, forecasts, scenarios and shareable reports.",
  path: "/pricing",
});

const REASSURING = [
  "No credit card required to start",
  "One-time payment for Pro (lifetime)",
  "Your data stays yours — export or delete it whenever you want",
];

function limitList(p: {
  maxVehicles: number;
  maxExpensesPerMonth: number;
  aiConversationsPerMonth: number;
  forecastHorizonMonths: number;
  reportRetentionDays: number;
  enableAdvancedScenarios: boolean;
  enableShareableReports: boolean;
  enablePdfReports: boolean;
  aiReceiptScansPerMonth: number;
}): Array<[string, string | boolean]> {
  return [
    [p.maxVehicles === 1 ? "1 vehicle" : `Up to ${p.maxVehicles} vehicles`, true],
    [`${p.maxExpensesPerMonth.toLocaleString("en-US")} expenses`, true],
    ["Cost per km + monthly breakdown", true],
    ["Fuel & consumption tracking", true],
    [`${p.forecastHorizonMonths}-month forecast horizon`, true],
    [
      p.reportRetentionDays >= 365
        ? `${Math.round(p.reportRetentionDays / 365)}+ year${p.reportRetentionDays >= 730 ? "s" : ""} of report history`
        : `${p.reportRetentionDays} days of report history`,
      true,
    ],
    [
      p.aiConversationsPerMonth > 0 ? `${p.aiConversationsPerMonth} Ask Your Car questions` : "Ask Your Car",
      p.aiConversationsPerMonth > 0,
    ],
    [
      "AI receipt scanning",
      p.aiReceiptScansPerMonth > 0 ? (COMING_SOON_FEATURES.receiptScanning ? "Coming soon" : true) : false,
    ],
    ["What-if scenarios", p.enableAdvancedScenarios],
    ["Shareable reports", p.enableShareableReports],
    ["PDF report download", p.enablePdfReports],
  ];
}

export default async function PricingPage() {
  const t = getT();

  const user = await getCurrentUser();
  const ent = user ? await getEntitlements(user) : null;

  // Read the existing Pro plan row for limits/quotas (do not invent numbers)
  const proPlan = await db.plan.findFirst({ where: { key: "pro", active: true } });

  const freePlan = await db.plan.findFirst({ where: { key: "free", active: true } });

  const configured = paypalConfigured();
  const grantAvailable = configured ? await lifetimeGrantAvailable() : false;

  const state = lifetimeOfferState({
    isLifetime: Boolean(ent?.isLifetime),
    configured,
    grantAvailable,
    isSignedIn: Boolean(user),
    isVerified: Boolean(user?.emailVerifiedAt),
  });

  const priceLabel = lifetimeOfferPriceLabel();
  const clientId = paypalSdkClientId();
  const currency = lifetimeCurrency();

  const proLimits = proPlan
    ? {
        vehicles: proPlan.maxVehicles,
        expenses: proPlan.maxExpensesPerMonth,
        questions: proPlan.aiConversationsPerMonth,
      }
    : { vehicles: 5, expenses: 1000, questions: 100 };

  const freeFeatures = (freePlan?.features ? JSON.parse(freePlan.features) : []) as string[];

  return (
    <MarketingShell>
      <TrackEvent event="pricing_view" onceKey="pricing" />
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold">{t("pricing.title")}</h1>
          <p className="mt-3 text-charcoal-600 dark:text-charcoal-300 max-w-2xl mx-auto">
            {t("pricing.subtitle")}
          </p>
          <p className="mt-3 text-sm text-charcoal-600 dark:text-charcoal-300 max-w-2xl mx-auto">
            {t("pricing.trial_note")}
          </p>
        </div>

        {ent && !ent.isLifetime && (
          <div
            className="card mt-8 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10"
            role="status"
          >
            <p className="font-semibold">
              {t("pricing.current_on")} <span className="text-emerald-700 dark:text-emerald-300">{ent.planName}</span>
            </p>
            <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-1">
              {ent.isTrial && ent.trialEndsAt
                ? `${t("pricing.trial_ends")} ${ent.trialEndsAt.toISOString().slice(0, 10)}.`
                : ent.currentPeriodEnd && !ent.isTrial
                  ? `${t("pricing.access_until")} ${ent.currentPeriodEnd.toISOString().slice(0, 10)}.`
                  : `${t("pricing.free_plan")}.`}{" "}
              <Link href="/settings/billing" className="underline">
                {t("pricing.manage_billing")}
              </Link>
            </p>
          </div>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2 max-w-3xl mx-auto items-stretch">
          <div data-plan="free" className="card flex flex-col h-full">
            <div className="flex items-start justify-between gap-2">
              <p className="text-lg font-bold">{t("pricing.free")}</p>
              {ent && ent.planKey === "free" && !ent.isTrial && !ent.isLifetime && (
                <span className="badge badge-ok shrink-0">{t("pricing.current")}</span>
              )}
            </div>
            <p className="text-sm text-charcoal-500 mt-1">{t("pricing.free_tagline")}</p>
            <p className="mt-4">
              <span className="text-3xl font-extrabold">{t("pricing.free_price")}</span>
            </p>
            <p className="text-xs text-charcoal-500 mt-1">{t("pricing.free_forever")}</p>

            {freeFeatures.length > 0 && (
              <ul className="mt-4 text-sm space-y-1">
                {freeFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 pt-0 flex-1 flex items-end">
              {user ? (
                <Link href="/dashboard" className="btn btn-secondary w-full">
                  {t("pricing.go_dashboard")}
                </Link>
              ) : (
                <Link href="/signup" className="btn btn-primary w-full">
                  {t("pricing.start_free")}
                </Link>
              )}
            </div>
          </div>

          <LifetimeOfferCard
            t={t}
            state={state}
            priceLabel={priceLabel}
            clientId={clientId}
            currency={currency}
            limits={proLimits}
            className={ent?.isLifetime ? "ring-2" : ""}
          />
        </div>

        {proPlan && (
          <div className="card mt-8 max-w-3xl mx-auto">
            <p className="font-semibold">{t("pricing.pro_includes")}</p>
            <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-sm text-charcoal-600 dark:text-charcoal-300">
              {limitList(proPlan).map(([label, ok]) => (
                <li key={label} className="flex items-start gap-2">
                  {ok === true ? (
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <span className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className={ok === false ? "text-charcoal-400" : ""}>
                    {label}
                    {ok === "Coming soon" ? " (Coming soon)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card mt-8 max-w-3xl mx-auto">
          <p className="font-semibold">{t("pricing.good_to_know")}</p>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-sm text-charcoal-600 dark:text-charcoal-300">
            {REASSURING.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-charcoal-600 dark:text-charcoal-300">
            {t("pricing.not_sure")}{" "}
            <Link href="/calculators/car-cost" className="underline">
              {t("pricing.calc_first")}
            </Link>{" "}
            {t("pricing.calc_note")}{" "}
            <Link href="/settings/billing" className="underline">
              {t("pricing.billing_link")}
            </Link>
            .
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}