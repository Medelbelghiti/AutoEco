import Link from "next/link";
import { UNAVAILABLE_PLAN_KEYS } from "@/lib/plans";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { formatMoney } from "@/lib/finance";
import { stripeConfigured, paddleConfigured } from "@/lib/env";
import { getPriceIdFor, PADDLE_PLAN_KEYS, isPaddlePlanKey } from "@/lib/paddle";
import { BillingClient } from "./Client";

const PERIOD_SUFFIX: Record<string, string> = {
  MONTHLY: "/mo",
  YEARLY: "/yr",
  LIFETIME: " one-time",
};

export default async function BillingPage() {
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
  const stripeBillingEnabled = stripeConfigured();
  const paddleBillingEnabled = paddleConfigured();

  // Resolve Paddle price ids server-side so we never expose them in source.
  const paddlePriceIds: Record<string, string> = {};
  for (const p of plans) {
    if (p.priceCents === 0) continue;
    if (!isPaddlePlanKey(p.key)) continue;
    try {
      paddlePriceIds[p.key] = getPriceIdFor(p.key);
    } catch {
      // price id not configured for this plan
    }
  }

  const providerEnabled = paddleBillingEnabled || stripeBillingEnabled;

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

      {!providerEnabled && (
        <div className="card border-amber-300 bg-amber-50 text-sm dark:bg-amber-900/10 dark:border-amber-800" role="status">
          <p className="font-semibold text-amber-800 dark:text-amber-200">Paid plans are not configured on this server.</p>
          <p className="mt-1 text-amber-700 dark:text-amber-200/80">
            Set <code>PADDLE_API_KEY</code>, <code>PADDLE_WEBHOOK_SECRET</code>, <code>PADDLE_SELLER_ID</code> and at
            least one of <code>PADDLE_PRO_PRICE_ID</code> / <code>PADDLE_FAMILY_PRICE_ID</code> /
            <code> PADDLE_BUSINESS_PRICE_ID</code> to enable checkout. Your current free plan works fully in the
            meantime.
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
          {!ent.isLifetime && ent.currentPeriodEnd && (
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
          {ent.isLifetime && (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-charcoal-500">Renewal</dt>
              <dd className="font-medium">None — lifetime</dd>
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
          isLifetime={ent.isLifetime}
          email={user.email}
        />
      </section>

      <section className="card" aria-labelledby="plans-heading">
        <p id="plans-heading" className="font-semibold">Change plan</p>
        {plans.length === 0 ? (
          <p className="text-sm text-charcoal-500 mt-2">No plans are available right now.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            {plans.map((p) => {
              const isCurrent = p.key === ent.planKey;
              const isFree = p.priceCents === 0;
              const priceId = paddlePriceIds[p.key];
              const purchasable = !isFree && paddleBillingEnabled && !!priceId;
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
                      planKey={p.key}
                      priceId={purchasable ? priceId : ""}
                      userId={user.id}
                      email={user.email}
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
                    <td className="font-mono text-xs">{i.number ?? i.stripeInvoiceId.slice(0, 16)}</td>
                    <td>{i.createdAt.toISOString().slice(0, 10)}</td>
                    <td>{formatMoney(i.amountCents, i.currency)}</td>
                    <td>
                      <span className={`badge ${i.status === "paid" ? "badge-ok" : "badge-warn"}`}>{i.status}</span>
                    </td>
                    <td>
                      {i.pdfUrl && (
                        <a href={i.pdfUrl} target="_blank" rel="noopener noreferrer" className="underline text-xs">
                          Download<span className="sr-only"> invoice {i.number ?? i.stripeInvoiceId}</span>
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
                    <span className="font-mono text-xs break-all">{i.number ?? i.stripeInvoiceId.slice(0, 16)}</span>
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