import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { formatMoney } from "@/lib/finance";
import { paddleConfigured } from "@/lib/env";
import { paypalConfigured, paypalSdkClientId, lifetimePriceMinor, lifetimeCurrency } from "@/lib/paypal";
import { lifetimeGrantAvailable } from "@/lib/paypal-billing";
import { PayPalLifetimeButton } from "@/components/PayPalLifetimeButton";
import { getT } from "@/lib/server-i18n";
import { BillingClient } from "./Client";
import { LIFETIME_PLAN_NAME, lifetimeOfferState } from "@/lib/lifetime-offer";

/**
 * What to show as the invoice reference. `number` is set by Lemon only, and the
 * webhook never populates it, so falling back to the old required-but-misnamed
 * `stripeInvoiceId` column rendered the literal text "paddle_invoice_" for
 * every Paddle invoice.
 */
function invoiceRef(i: {
  number: string | null;
  paddleOrderId: string | null;
  lemonOrderId: string | null;
}): string {
  return i.number ?? i.paddleOrderId ?? i.lemonOrderId ?? "—";
}

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
  const paddleBillingEnabled = paddleConfigured();
  const providerEnabled = paddleBillingEnabled;

  const t = getT();
  const configured = paypalConfigured();
  const grantAvailable = configured ? await lifetimeGrantAvailable() : false;
  const state = lifetimeOfferState({
    isLifetime: ent.isLifetime || ent.subscriptionStatus === "lifetime",
    configured,
    grantAvailable,
    isSignedIn: true,
    isVerified: Boolean(user.emailVerifiedAt),
  });
  const showLifetime = state === "ready" || state === "verify";

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

      {!providerEnabled && !configured && (
        <div className="card border-amber-300 bg-amber-50 text-sm dark:bg-amber-900/10 dark:border-amber-800" role="status">
          <p className="font-semibold text-amber-800 dark:text-amber-200">Billing is not enabled.</p>
          <p className="mt-1 text-amber-700 dark:text-amber-200/80">
            Paid checkout is not available right now. The free plan works fully in the meantime.
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
          email={user.email}
        />
      </section>

      {(state === "active" || state === "ready" || state === "verify") && (
        <section className="card border-emerald-500 ring-1 ring-emerald-500/40" aria-labelledby="lifetime-heading">
          <p id="lifetime-heading" className="font-semibold">{LIFETIME_PLAN_NAME}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("lifetime.subtitle")}</p>
          {state !== "active" && (
            <p className="mt-2">
              <span className="text-2xl font-extrabold">
                {formatMoney(lifetimePriceMinor(), lifetimeCurrency())}
              </span>
              <span className="text-sm text-charcoal-500"> {t("lifetime.price_note")}</span>
            </p>
          )}
          <p className="text-xs text-charcoal-500 mt-1">{t("lifetime.includes")}</p>
          <div className="mt-3 max-w-xs">
            {state === "active" && (
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{t("lifetime.current")}</p>
            )}
            {state === "verify" && (
              <p className="text-sm text-charcoal-500">{t("lifetime.verified_only")}</p>
            )}
            {state === ("unavailable" as typeof state) && (
              <p className="text-sm text-charcoal-500">{t("pricing.unavailable")}</p>
            )}
            {state === "ready" && (
              <PayPalLifetimeButton
                clientId={paypalSdkClientId()}
                currency={lifetimeCurrency()}
                label={t("lifetime.cta")}
              />
            )}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="plans-heading">
        <p id="plans-heading" className="font-semibold">{t("settings.plans")}</p>
        <p className="text-sm text-charcoal-500 mt-2">{t("pricing.one_offer")}</p>
        <div className="mt-3">
          <Link href="/pricing" className="btn btn-secondary">
            {t("nav.pricing")}
          </Link>
        </div>
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