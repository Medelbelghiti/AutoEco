import Link from "next/link";
import type { Translate } from "@/lib/i18n";
import { LIFETIME_PLAN_NAME, type LifetimeOfferState } from "@/lib/lifetime-offer";
import { PayPalLifetimeButton } from "./PayPalLifetimeButton";

interface Props {
  t: Translate;
  state: LifetimeOfferState;
  /** Formatted from server config; null when checkout is not configured. */
  priceLabel: string | null;
  clientId: string;
  currency: string;
  /** Pro limits read from the plan row. Omit where limits are listed elsewhere. */
  limits?: { vehicles: number; expenses: number; questions: number };
  className?: string;
}

/**
 * The single paid offer: "Pro (lifetime)". It is deliberately the only
 * purchase UI on the site. Billing, cancel and renewal flows are not offered
 * here because the product is a one-time purchase.
 */
export function LifetimeOfferCard({
  t,
  state,
  priceLabel,
  clientId,
  currency,
  limits,
  className = "",
}: Props) {
  return (
    <div
      data-plan="pro-lifetime"
      data-purchase-state={state}
      className={`card flex flex-col h-full border-emerald-500 ring-1 ring-emerald-500/40 ${className}`.trim()}
    >
      <p className="text-lg font-bold">{LIFETIME_PLAN_NAME}</p>
      <p className="text-sm text-charcoal-500 mt-1">{t("lifetime.subtitle")}</p>

      {priceLabel && (
        <p className="mt-4">
          <span className="text-3xl font-extrabold">{priceLabel}</span>{" "}
          <span className="text-sm font-medium text-charcoal-500">{t("lifetime.price_note")}</span>
        </p>
      )}

      {limits && (
        <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-3">
          {t("pricing.pro_limits", {
            vehicles: limits.vehicles,
            expenses: limits.expenses,
            questions: limits.questions,
          })}
        </p>
      )}

      <div className="mt-6 pt-0 flex-1 flex items-end">
        <div className="w-full">
          {state === "active" ? (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {t("lifetime.current")}
            </p>
          ) : state === "unavailable" ? (
            <p className="text-sm text-charcoal-500">{t("pricing.unavailable")}</p>
          ) : state === "signup" ? (
            <Link href="/signup?plan=lifetime&next=%2Fpricing" className="btn btn-accent w-full">
              {t("pricing.signup_plan", { plan: LIFETIME_PLAN_NAME })}
            </Link>
          ) : state === "verify" ? (
            <p className="text-sm text-charcoal-500">{t("lifetime.verified_only")}</p>
          ) : (
            <div data-purchase="paypal">
              <PayPalLifetimeButton
                clientId={clientId}
                currency={currency}
                label={t("lifetime.cta")}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
