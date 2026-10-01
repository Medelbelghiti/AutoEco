import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { formatMoney } from "@/lib/finance";
import { stripeConfigured, paddleConfigured } from "@/lib/env";
import { getPriceIdFor, type PaddlePlanKey } from "@/lib/paddle";
import { BillingClient } from "./Client";

const PADDLE_PLAN_KEYS: PaddlePlanKey[] = ["pro", "business", "pro_plus", "lifetime"];

export default async function BillingPage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const sub = await db.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const invoices = await db.invoice.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const plans = await db.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const stripeBillingEnabled = stripeConfigured();
  const paddleBillingEnabled = paddleConfigured();

  // Resolve Paddle price ids server-side so we never expose them in
  // source. Only plans that map cleanly to a configured Paddle price id
  // will be presented as Paddle-enabled in the picker.
  const paddlePriceIds: Record<string, string> = {};
  for (const key of PADDLE_PLAN_KEYS) {
    try {
      paddlePriceIds[key] = getPriceIdFor(key);
    } catch {
      // variant id not configured for this plan
    }
  }

  const providerEnabled = paddleBillingEnabled ? "paddle" : stripeBillingEnabled ? "stripe" : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-charcoal-500 underline">← Back to settings</Link>
        <h1 className="text-2xl font-bold mt-2">Billing</h1>
      </div>

      {!providerEnabled && (
        <div className="card border-amber-300 bg-amber-50 text-sm">
          <p className="font-semibold text-amber-800">Billing is not configured on this server.</p>
          <p className="mt-1 text-amber-700">Set the Paddle environment variables (<code>PADDLE_API_KEY</code>, <code>PADDLE_WEBHOOK_SECRET</code>, <code>PADDLE_SELLER_ID</code>, <code>PADDLE_PRO_PRICE_ID</code>, <code>PADDLE_BUSINESS_PRICE_ID</code>, <code>PADDLE_LIFETIME_PRICE_ID</code>) in your Vercel project to enable paid plans.</p>
        </div>
      )}

      <div className="card">
        <p className="font-semibold">Current plan</p>
        <p className="text-3xl font-extrabold mt-1">{ent.planName}</p>
        <p className="text-sm text-charcoal-500">Status: <strong>{ent.subscriptionStatus ?? "free"}</strong></p>
        {ent.currentPeriodEnd && !ent.isLifetime && <p className="text-sm text-charcoal-500">Renews: {ent.currentPeriodEnd.toISOString().slice(0, 10)}</p>}
        {ent.isTrial && ent.trialEndsAt && <p className="text-sm text-amber-700">Trial ends {ent.trialEndsAt.toISOString().slice(0, 10)}</p>}
        <BillingClient
          hasSubscription={Boolean(sub && sub.status !== "lifetime")}
          subCancelAtEnd={sub?.cancelAtPeriodEnd ?? false}
          isLifetime={ent.isLifetime}
          email={user.email}
        />
      </div>

      <div className="card">
        <p className="font-semibold">Available plans</p>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          {plans.map((p) => {
            const paddlePriceId = PADDLE_PLAN_KEYS.includes(p.key as PaddlePlanKey) ? paddlePriceIds[p.key as PaddlePlanKey] : undefined;
            const usePaddle = paddleBillingEnabled && !!paddlePriceId;
            return (
              <div key={p.id} className="border border-charcoal-200 dark:border-charcoal-700 rounded-md p-3 text-sm">
                <p className="font-bold">{p.name}</p>
                <p className="text-charcoal-500">{formatMoney(p.priceCents, p.currency)}{p.billingPeriod === "MONTHLY" ? "/mo" : p.billingPeriod === "YEARLY" ? "/yr" : ""}</p>
                <p className="text-xs text-charcoal-500 mt-1">{p.maxVehicles} vehicles · {p.maxExpensesPerMonth} expenses/mo · {p.aiConversationsPerMonth} AI chats/mo</p>
                <BillingClient
                  isPlanPicker
                  planName={p.name}
                  planKey={PADDLE_PLAN_KEYS.includes(p.key as PaddlePlanKey) ? (p.key as PaddlePlanKey) : undefined}
                  priceId={paddlePriceId}
                  email={user.email}
                  disabled={p.key === ent.planKey}
                />
                {!usePaddle && (
                  <p className="mt-2 text-[11px] text-charcoal-400">
                    Configure Paddle price id for this plan.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <p className="font-semibold">Invoices</p>
        {invoices.length === 0 ? (
          <p className="text-sm text-charcoal-500 mt-2">No invoices yet.</p>
        ) : (
          <table className="basic mt-2">
            <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.number ?? i.stripeInvoiceId.slice(0, 12)}</td>
                  <td>{i.createdAt.toISOString().slice(0, 10)}</td>
                  <td>{formatMoney(i.amountCents, i.currency)}</td>
                  <td><span className={`badge ${i.status === "paid" ? "badge-ok" : "badge-warn"}`}>{i.status}</span></td>
                  <td>{i.pdfUrl && <a className="underline text-xs" href={i.pdfUrl} target="_blank" rel="noopener">download</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
