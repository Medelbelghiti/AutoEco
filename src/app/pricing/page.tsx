import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { MarketingShell } from "@/components/MarketingShell";
import { TrackEvent } from "@/components/TrackEvent";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/finance";
import { safeJsonParse } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { getEntitlements } from "@/lib/plans";
import { paddleConfigured } from "@/lib/env";
import { getPriceIdFor, PADDLE_PLAN_KEYS, isPaddlePlanKey } from "@/lib/paddle";
import { pageMeta } from "@/lib/seo";
import { PricingCheckout } from "./Checkout";

export const metadata = pageMeta({
  title: "Pricing",
  description:
    "AutoEco plans: start free with one vehicle, then unlock cost-per-kilometer tracking, forecasts, scenarios and shareable reports. Cancel anytime.",
  path: "/pricing",
});

const PERIOD_SUFFIX: Record<string, string> = {
  MONTHLY: "/month",
  YEARLY: "/year",
  LIFETIME: "one-time",
};

/**
 * Human-readable limit rows, derived from the SAME database columns that
 * `getEntitlements()` enforces server-side. Nothing here is invented.
 */
function limitRows(p: {
  maxVehicles: number;
  maxExpensesPerMonth: number;
  aiReceiptScansPerMonth: number;
  aiConversationsPerMonth: number;
  forecastHorizonMonths: number;
  reportRetentionDays: number;
  enableAdvancedScenarios: boolean;
  enableShareableReports: boolean;
  enableFamilySharing: boolean;
  enableApiAccess: boolean;
}): Array<[string, string]> {
  return [
    ["Vehicles", p.maxVehicles === 1 ? "1 vehicle" : `Up to ${p.maxVehicles} vehicles`],
    ["Expenses tracked", `${p.maxExpensesPerMonth.toLocaleString("en-US")} / month`],
    ["Cost per km + monthly breakdown", "Included"],
    ["Fuel & consumption tracking", "Included"],
    ["Future cost forecast", `${p.forecastHorizonMonths}-month horizon`],
    ["Report history", `${p.reportRetentionDays >= 365 ? `${Math.round(p.reportRetentionDays / 365)}+ year${p.reportRetentionDays >= 730 ? "s" : ""}` : `${p.reportRetentionDays} days`}`],
    ["Ask Your Car (grounded Q&A)", p.aiConversationsPerMonth > 0 ? `${p.aiConversationsPerMonth} questions / month` : "Not included"],
    ["AI receipt scanning", p.aiReceiptScansPerMonth > 0 ? `${p.aiReceiptScansPerMonth} scans / month` : "Not included"],
    ["What-if scenarios", p.enableAdvancedScenarios ? "Included" : "Not included"],
    ["Shareable reports", p.enableShareableReports ? "Included" : "Not included"],
    ["Family sharing", p.enableFamilySharing ? "Included" : "Not included"],
    ["API access", p.enableApiAccess ? "Included" : "Not included"],
  ];
}

const REASSURING = [
  "No credit card required to start",
  "Cancel or downgrade at any time",
  "You keep access until the end of the period you paid for",
  "Your data stays yours — export or delete it whenever you want",
];

export default async function PricingPage() {
  // Defense in depth: `isDemo` marks rows created by tests. They must
  // never reach a pricing page or a billing flow.
  const plans = await db.plan.findMany({
    where: { active: true, isDemo: false },
    orderBy: { sortOrder: "asc" },
  });

  const billingLive = paddleConfigured();

  // Resolve Paddle price ids server-side so nothing is hardcoded in source.
  // Only plans with a configured price can actually be purchased.
  const priceIds: Record<string, string> = {};
  for (const p of plans) {
    if (p.priceCents === 0) continue;
    if (!isPaddlePlanKey(p.key)) continue;
    try {
      priceIds[p.key] = getPriceIdFor(p.key);
    } catch {
      // Price id not configured for this plan — surfaced in the UI below.
    }
  }

  // Signed-in visitors see their real plan state and can buy immediately.
  const user = await getCurrentUser();
  const ent = user ? await getEntitlements(user) : null;
  const activeSub = user
    ? await db.subscription.findFirst({
        where: { userId: user.id, status: { in: ["active", "trialing", "past_due", "lifetime"] } },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const highlightKey = ent && ent.planKey !== "trial" ? ent.planKey : "pro";
  const featured = plans.find((p) => p.key === highlightKey) ?? plans.find((p) => p.priceCents > 0) ?? null;

  return (
    <MarketingShell>
      <TrackEvent event="pricing_view" onceKey="pricing" />
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold">Plans</h1>
          <p className="mt-3 text-charcoal-600 dark:text-charcoal-300 max-w-2xl mx-auto">
            Start free with one vehicle. Upgrade when you want cost-per-kilometer tracking, longer
            forecasts and shareable reports. Cancel whenever you like.
          </p>
        </div>

        {ent && (
          <div
            className="card mt-8 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10"
            role="status"
          >
            <p className="font-semibold">
              You are currently on <span className="text-emerald-700 dark:text-emerald-300">{ent.planName}</span>
            </p>
            <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-1">
              {ent.isTrial && ent.trialEndsAt
                ? `Free trial — ends ${ent.trialEndsAt.toISOString().slice(0, 10)}.`
                : ent.isLifetime
                  ? "Lifetime plan — no renewal."
                  : activeSub?.cancelAtPeriodEnd && ent.currentPeriodEnd
                    ? `Cancels at the end of the current period (${ent.currentPeriodEnd.toISOString().slice(0, 10)}). You keep access until then.`
                    : activeSub
                      ? `Renews ${ent.currentPeriodEnd ? ent.currentPeriodEnd.toISOString().slice(0, 10) : "each period"}.`
                      : "Free plan."}{" "}
              <Link href="/settings/billing" className="underline">
                Manage billing
              </Link>
            </p>
          </div>
        )}

        {!billingLive && (
          <div className="card mt-6 border-amber-300 bg-amber-50 text-sm dark:bg-amber-900/10 dark:border-amber-800">
            <p className="font-semibold text-amber-800 dark:text-amber-200">Checkout is not configured yet.</p>
            <p className="mt-1 text-amber-700 dark:text-amber-200/80">
              The plans and prices below are the real configured plans. Paid checkout becomes available once
              the Paddle environment variables are set on the server. The free plan works right now.
            </p>
          </div>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-start">
          {plans.map((p) => {
            const isFree = p.priceCents === 0;
            const isCurrent = ent?.planKey === p.key;
            const priceId = priceIds[p.key];
            const purchasable = !isFree && billingLive && !!priceId;
            const features = safeJsonParse<string[]>(p.features, []);
            const suffix = PERIOD_SUFFIX[p.billingPeriod] ?? "";

            return (
              <div
                key={p.id}
                className={`card flex flex-col h-full ${
                  p.key === featured?.key ? "border-emerald-500 ring-1 ring-emerald-500/40" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-bold">{p.name}</p>
                  {isCurrent && <span className="badge badge-ok shrink-0">Current plan</span>}
                  {!isCurrent && p.key === featured?.key && <span className="badge badge-info shrink-0">Most popular</span>}
                </div>
                {p.description && <p className="text-sm text-charcoal-500 mt-1">{p.description}</p>}

                <p className="mt-4">
                  <span className="text-3xl font-extrabold">{formatMoney(p.priceCents, p.currency)}</span>
                  {suffix && <span className="text-sm font-medium text-charcoal-500">{suffix}</span>}
                </p>
                <p className="text-xs text-charcoal-500 mt-1">
                  {isFree
                    ? "Free forever"
                    : p.billingPeriod === "MONTHLY"
                      ? "Billed monthly. Cancel anytime."
                      : p.billingPeriod === "YEARLY"
                        ? "Billed yearly. Cancel anytime."
                        : "One-time payment."}
                </p>

                {features.length > 0 && (
                  <ul className="mt-4 text-sm space-y-1">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <details className="mt-4 group">
                  <summary className="text-xs font-semibold text-charcoal-600 dark:text-charcoal-300 cursor-pointer select-none">
                    Full plan limits
                  </summary>
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {limitRows(p).map(([label, value]) => {
                      const included = !/^(Not included|0 )/.test(value);
                      return (
                        <li key={label} className="flex items-start justify-between gap-3">
                          <span className="text-charcoal-500">{label}</span>
                          <span
                            className={`text-right font-medium ${included ? "" : "text-charcoal-400"}`}
                          >
                            {included ? (
                              <Check className="w-3.5 h-3.5 inline text-emerald-600" aria-hidden="true" />
                            ) : (
                              <Minus className="w-3.5 h-3.5 inline" aria-hidden="true" />
                            )}{" "}
                            {value}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>

                <div className="mt-6 pt-0 flex-1 flex items-end">
                  {isCurrent ? (
                    <Link href="/settings/billing" className="btn btn-secondary w-full">
                      Manage plan
                    </Link>
                  ) : isFree ? (
                    user ? (
                      <Link href="/dashboard" className="btn btn-primary w-full">
                        Go to dashboard
                      </Link>
                    ) : (
                      <Link href="/signup" className="btn btn-primary w-full">
                        Start free
                      </Link>
                    )
                  ) : user ? (
                    <PricingCheckout
                      priceId={purchasable ? priceId : ""}
                      planKey={p.key}
                      planName={p.name}
                      userId={user.id}
                      email={user.email}
                      checkoutReady={purchasable}
                    />
                  ) : (
                    <Link href={`/signup?plan=${p.key}`} className="btn btn-accent w-full">
                      Sign up to choose {p.name}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card mt-8">
          <p className="font-semibold">Good to know</p>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-sm text-charcoal-600 dark:text-charcoal-300">
            {REASSURING.map((r) => (
              <li key={r} className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-charcoal-600 dark:text-charcoal-300">
            Not sure yet?{" "}
            <Link href="/calculators/car-cost" className="underline">
              Calculate your true car cost first
            </Link>{" "}
            — free, no account needed. Full billing history and invoices live in{" "}
            <Link href="/settings/billing" className="underline">
              Settings ? Billing
            </Link>
            .
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}