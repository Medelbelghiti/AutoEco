import { formatMoney } from "./finance";
import { lifetimeCurrency, lifetimePriceMinor, paypalConfigured } from "./paypal";

/** Product name. Never translated, like the brand. */
export const LIFETIME_PLAN_NAME = "Pro (lifetime)";

/**
 * What the paid card can offer right now.
 *
 * `active` wins over everything else so an existing lifetime holder never
 * sees a checkout again. Otherwise availability is checked before identity,
 * so a sold-out or misconfigured offer never asks a logged-out visitor to
 * sign up for something they cannot buy.
 */
export type LifetimeOfferState =
  | "active"
  | "unavailable"
  | "signup"
  | "verify"
  | "ready";

export function lifetimeOfferState(input: {
  isLifetime: boolean;
  configured: boolean;
  grantAvailable: boolean;
  isSignedIn: boolean;
  isVerified: boolean;
}): LifetimeOfferState {
  if (input.isLifetime) return "active";
  if (!input.configured || !input.grantAvailable) return "unavailable";
  if (!input.isSignedIn) return "signup";
  if (!input.isVerified) return "verify";
  return "ready";
}

/**
 * The displayed price, formatted with `Intl` from the server configuration.
 * Returns null when checkout is not fully configured, so the page can show
 * "Not available yet" without inventing or hardcoding an amount.
 */
export function lifetimeOfferPriceLabel(): string | null {
  if (!paypalConfigured()) return null;
  return formatMoney(lifetimePriceMinor(), lifetimeCurrency());
}
