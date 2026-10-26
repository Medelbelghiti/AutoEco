import Link from "next/link";
import { Check } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import type { LifetimeOfferState } from "@/lib/lifetime-offer";
import { LifetimeOfferCard } from "./LifetimeOfferCard";

export interface FreePlanSummary {
  name: string;
  features: string[];
}

interface Props {
  t: Translate;
  free: FreePlanSummary;
  pro: { vehicles: number; expenses: number; questions: number };
  isSignedIn: boolean;
  currentPlan: "free" | "lifetime" | null;
  state: LifetimeOfferState;
  priceLabel: string | null;
  clientId: string;
  currency: string;
}

/** Free + the one paid offer. Two cards, never a recurring plan grid. */
export function PricingPlans({
  t,
  free,
  pro,
  isSignedIn,
  currentPlan,
  state,
  priceLabel,
  clientId,
  currency,
}: Props) {
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 max-w-3xl mx-auto items-stretch">
      <div data-plan="free" className="card flex flex-col h-full">
        <div className="flex items-start justify-between gap-2">
          <p className="text-lg font-bold">{free.name}</p>
          {currentPlan === "free" && (
            <span className="badge badge-ok shrink-0">{t("pricing.current")}</span>
          )}
        </div>
        <p className="text-sm text-charcoal-500 mt-1">{t("pricing.free_tagline")}</p>

        {free.features.length > 0 && (
          <ul className="mt-4 text-sm space-y-1">
            {free.features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 pt-0 flex-1 flex items-end">
          {isSignedIn ? (
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
        limits={pro}
        className={currentPlan === "lifetime" ? "ring-2" : ""}
      />
    </div>
  );
}
