"use client";

import { WhopCheckoutButton } from "@/components/WhopCheckoutButton";

interface Props {
  planKey: "pro" | "pro_plus";
  planName: string;
  /** False when the server has no working Whop configuration for this plan. */
  checkoutReady: boolean;
}

/**
 * Thin client wrapper so the pricing grid itself stays a server component.
 * Plan ids are resolved server-side; nothing is hardcoded here.
 */
export function PricingCheckout({ planKey, planName, checkoutReady }: Props) {
  return (
    <WhopCheckoutButton
      planKey={planKey}
      label={`Choose ${planName}`}
      className="btn btn-accent w-full"
      disabled={!checkoutReady}
      unavailableHint="Paid checkout is not configured on this server yet. The free plan is fully available."
    />
  );
}
