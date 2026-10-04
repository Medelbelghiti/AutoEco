export const AFFILIATE_COOKIE_NAME = "lg_aff";
export interface AffiliateSettings {
  affiliate_enabled: boolean;
  commission_percentage: number;
  cookie_duration_days: number;
  minimum_payout_cents: number;
  payout_method: string;
}
export async function applyForAffiliate() { return { ok: false, error: "Affiliate program coming in V2." }; }
export async function getAffiliateByCode() { return null; }
export async function recordAffiliateClick(): Promise<void> {}
export async function attributeAffiliateOnSignup(): Promise<void> {}
export async function processAffiliateCommission(): Promise<void> {}
export async function markAffiliatePaid(): Promise<void> {}
/**
 * Build a shareable referral/affiliate link.
 *
 * The affiliate programme is not enabled yet (`affiliate_enabled` is off
 * and every affiliate stub is a no-op), so this builder must not emit a URL
 * that 404s. `referrals.ts` already uses the working `/signup?ref=` form;
 * do the same here so wiring the programme up later cannot ship a dead link.
 */
export function buildAffiliateLink(appUrl: string, code: string): string {
  return `${appUrl}/signup?ref=${encodeURIComponent(code)}`;
}
