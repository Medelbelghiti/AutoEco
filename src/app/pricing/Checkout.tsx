"use client";

import { PaddleButton } from "@/components/PaddleButton";

interface Props {
  /** Empty string when no Paddle price is configured for this plan. */
  priceId: string;
  planKey: string;
  planName: string;
  userId: string;
  email: string;
  /** False when the server has no working Paddle configuration. */
  checkoutReady: boolean;
}

/**
 * Thin client wrapper so the pricing grid itself stays a server component.
 * All price ids are resolved server-side; nothing is hardcoded here.
 */
export function PricingCheckout({
  priceId,
  planKey,
  planName,
  userId,
  email,
  checkoutReady,
}: Props) {
  return (
    <PaddleButton
      priceId={priceId}
      userId={userId}
      planKey={planKey}
      email={email}
      label={`Choose ${planName}`}
      className="btn btn-accent w-full"
      unavailableHint={
        checkoutReady
          ? undefined
          : "Paid checkout is not configured on this server yet. The free plan is fully available."
      }
    />
  );
}