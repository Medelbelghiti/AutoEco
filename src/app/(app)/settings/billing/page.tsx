import Link from "next/link";
import { UNAVAILABLE_PLAN_KEYS } from "@/lib/plans";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { formatMoney } from "@/lib/finance";
import { whopConfigured, whopPlanPurchasable, LIFETIME_PLAN_KEY } from "@/lib/whop";
import { lifetimeGrantAvailable } from "@/lib/whop-billing";
import { WhopCheckoutButton } from "@/components/WhopCheckoutButton";
import { getT } from "@/lib/server-i18n";
import { BillingClient } from "./Client";

const PERIOD_SUFFIX: Record<string, string> = {
  MONTHLY: "/mo",
  YEARLY: "/yr",
};

/**
 * What to show as the invoice reference. Never the legacy, required-but-misnamed
 * `stripeInvoiceId` column (it holds synthetic values such as "whop_pay_...").
 */
function invoiceRef(i: {
  number: string | null;
  whopPaymentId: string | null;
  paddleOrderId: string | null;
  lemonOrderId: string | null;
}): string {
  return i.number ?? i.whopPaymentId ?? i.paddleOrderId ?? i.lemonOrderId ?? "—";
}

export default async function BillingPage({ searchParams }: { searchParams?: { checkout?: string } }) {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const sub = await db.subscription.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const invoices = await db.invoice.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  // `isDemo` marks test-created rows — they must never appear in a billing flow.
  const plans = await db.plan.findMany({
    where: { active: true, isDemo: false, key: { notIn: UNAVAILABLE_PLAN_KEYS } },
    orderBy: { sortOrder: "asc" },
  });
  const providerEnabled = whopConfigured();
  // Whop sends the buyer back here; access appears once the webhook lands.
  const returnedFromCheckout = searchParams?.checkout === "success";

  const t = getT();
  // The one-time Founder Lifetime offer, shown only when fully configured, a
  // slot is available and the user does not already hold it.
  const showLifetime = ent.subscriptionStatus !== "lifetime" && (await lifetimeGrantAvailable());
  const lifetimePlan = showLifetime
    ? await db.plan.findUnique({ where: { key: LIFETIME_PLAN_KEY }, select: { priceCents: true, currency: true } })
    : null;

  const statusTone =
    ent.subscriptionStatus === "active" || ent.subscriptionStatus === "lifetime"
      ? "badge-ok"
      : ent.subscriptionStatus === "trialing"
        ? "badge-info"
        : ent.subscriptionStatus === "past_due"
          ? "badge-warn"
          : "badge-info";

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-charcoal-500 underline">← Back to settings</Link>
        <h1 className="text-2xl font-bold mt-2">Billing</h1>
      </div>

      {returnedFromCheckout && (
        <div className="card border-emerald-300 bg-emerald-50/60 text-sm dark:bg-emerald-900/10 dark:border-emerald-800" role="status">
          <p className="font-semibold">Thanks! Your payment is being confirmed.</p>
          <p className="mt-1 text-charcoal-600 dark:text-charcoal-300">
            Your new plan appears here within a minute. Refresh the page if it does not show yet.
          </p>
        </div>
      )}

      {!providerEnabled && (
        <div className="card border-amber-300 bg-amber-50 text-sm dark:bg-amber-900/10 dark:border-amber-800" role="status">
          <p className="font-semibold text-amber-800 dark:text-amber-200">Paid plans are not configured on this server.</p>
          <p className="mt-1 text-amber-700 dark:text-amber-200/80">
            Set <code>WHOP_API_KEY</code>, <code>WHOP_WEBHOOK_SECRET</code>, <code>WHOP_COMPANY_ID</code> and at
            least one of <code>WHOP_PRO_PLAN_ID</code> / <code>WHOP_PRO_PLUS_PLAN_ID</code> to enable checkout.
            Your current free plan works fully in the meantime.
          </p>
        </div>
      )}

      <section className="card" aria-labelledby="current-plan-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p id="current-plan-heading" className="font-semibold">Current plan</p>
            <p className="text-3xl font-extrabold mt-1">{ent.planName}</p>
          </div>
          <span className={`badge ${statusTone}`}>{ent.subscriptionStatus ?? "free"}</span>
        </div>

        <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-charcoal-500">Billing period</dt>
            <dd className="font-medium">{ent.billingPeriod.toLowerCase()}</dd>
          </div>
          {ent.currentPeriodEnd && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-charcoal-500">
                {sub?.cancelAtPeriodEnd ? "Access ends" : "Renews"}
              </dt>
              <dd className="font-medium">
                {ent.currentPeriodEnd.toISOString().slice(0, 10)}
                {sub?.cancelAtPeriodEnd && " (cancelled — you keep access until then)"}
              </dd>
            </div>
          )}
          {ent.isTrial && ent.trialEndsAt && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-charcoal-500">Trial ends</dt>
              <dd className="font-medium text-amber-700 dark:text-amber-300">{ent.trialEndsAt.toISOString().slice(0, 10)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-charcoal-500">Vehicles</dt>
            <dd className="font-medium">up to {ent.maxVehicles}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-charcoal-500">Ask Your Car</dt>
            <dd className="font-medium">{ent.aiConversationsPerMonth} / month</dd>
          </div>
        </dl>

        <BillingClient
          hasSubscription={Boolean(sub && sub.status !== "lifetime" && sub.status !== "canceled")}
          subCancelAtEnd={sub?.cancelAtPeriodEnd ?? false}
        />
      </section>

      {showLifetime && lifetimePlan && (
        <section className="card border-emerald-500 ring-1 ring-emerald-500/40" aria-labelledby="lifetime-heading">
          <p id="lifetime-heading" className="font-semibold">{t("lifetime.title")}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("lifetime.subtitle")}</p>
          <p className="mt-2">
            <span className="text-2xl font-extrabold">
              {formatMoney(lifetimePlan.priceCents, lifetimePlan.currency)}
            </span>
            <span className="text-sm text-charcoal-500"> {t("lifetime.price_note")}</span>
          </p>
          <p className="text-xs text-charcoal-500 mt-1">{t("lifetime.includes")}</p>
          <div className="mt-3 max-w-xs">
            {user.emailVerifiedAt ? (
              <WhopCheckoutButton planKey="lifetime" label={t("lifetime.cta")} className="btn btn-accent w-full" />
            ) : (
              <p className="text-sm text-charcoal-500">{t("lifetime.verified_only")}</p>
            )}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="plans-heading">
        <p id="plans-heading" className="font-semibold">Change plan</p>
        {plans.length === 0 ? (
          <p className="text-sm text-charcoal-500 mt-2">No plans are available right now.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            {plans.map((p) => {
              const isCurrent = p.key === ent.planKey;
              const isFree = p.priceCents === 0;
              const checkoutKey = p.key === "pro" || p.key === "pro_plus" ? p.key : null;
              const purchasable = !isFree && checkoutKey !== null && whopPlanPurchasable(p.key);
              return (
                <div
                  key={p.id}
                  className={`border border-charcoal-200 dark:border-charcoal-700 rounded-md p-3 text-sm ${
                    isCurrent ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold">{p.name}</p>
                    {isCurrent && <span className="badge badge-ok">Current</span>}
                  </div>
                  <p className="text-charcoal-500">
                    {formatMoney(p.priceCents, p.currency)}
                    {PERIOD_SUFFIX[p.billingPeriod] ?? ""}
                  </p>
                  <p className="text-xs text-charcoal-500 mt-1">
                    {p.maxVehicles} vehicle{p.maxVehicles === 1 ? "" : "s"} · {p.maxExpensesPerMonth} expenses/mo ·{" "}
                    {p.aiConversationsPerMonth} AI questions/mo
                  </p>
                  {isFree && isCurrent ? (
                    <p className="mt-3 text-xs text-charcoal-500">
                      This is your current plan.{" "}
                      <Link href="/features" className="underline">
                        See what&apos;s included
                      </Link>
                      .
                    </p>
                  ) : (
                    <BillingClient
                      isPlanPicker
                      planName={p.name}
                      planKey={checkoutKey ?? undefined}
                      purchasable={purchasable}
                      disabled={isCurrent}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="invoices-heading">
        <p id="invoices-heading" className="font-semibold">Invoices</p>
        {invoices.length === 0 ? (
          <p className="text-sm text-charcoal-500 mt-2">No invoices yet.</p>
        ) : (
          <>
            {/* Desktop table */}
            <table className="basic mt-2 hidden sm:table">
              <caption className="sr-only">Your billing invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Download</span></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="font-mono text-xs">{invoiceRef(i)}</td>
                    <td>{i.createdAt.toISOString().slice(0, 10)}</td>
                    <td>{formatMoney(i.amountCents, i.currency)}</td>
                    <td>
                      <span className={`badge ${i.status === "paid" ? "badge-ok" : "badge-warn"}`}>{i.status}</span>
                    </td>
                    <td>
                      {i.pdfUrl && (
                        <a href={i.pdfUrl} target="_blank" rel="noopener noreferrer" className="underline text-xs">
                          Download<span className="sr-only"> invoice {invoiceRef(i)}</span>
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile card list — avoids horizontal scrolling at 360px */}
            <ul className="mt-2 space-y-2 sm:hidden">
              {invoices.map((i) => (
                <li key={i.id} className="rounded-lg border border-charcoal-200 dark:border-charcoal-700 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs break-all">{invoiceRef(i)}</span>
                    <span className={`badge ${i.status === "paid" ? "badge-ok" : "badge-warn"}`}>{i.status}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-charcoal-600 dark:text-charcoal-300">
                    <span>{i.createdAt.toISOString().slice(0, 10)}</span>
                    <span className="font-semibold">{formatMoney(i.amountCents, i.currency)}</span>
                  </div>
                  {i.pdfUrl && (
                    <a href={i.pdfUrl} target="_blank" rel="noopener noreferrer" className="underline text-xs mt-1 inline-block">
                      Download invoice
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}