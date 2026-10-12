/**
 * Canonical supported currency list for AutoEco.
 *
 * Single source of truth. Used by:
 *   - Zod schemas (so APIs reject "XXX", "ABC", etc.)
 *   - User preferences
 *   - Vehicle purchase / resale currency
 *   - Expense / Fuel currency
 *   - Savings goals / Reports
 */
/**
 * ONLY currencies with exactly 2 minor-unit digits belong here: every amount
 * in the app is stored as integer "cents" and divided by 100 for display.
 * Zero-decimal (JPY, KRW, ...) and three-decimal (KWD, BHD, ...) currencies need
 * per-currency minor-unit handling in formatMoney() first.
 */
export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "RON",
  "MAD", "DZD", "EGP", "AED", "SAR", "QAR", "TRY", "ILS", "ZAR", "NGN", "KES",
  "INR", "SGD", "HKD", "MYR", "THB", "PHP", "BRL", "MXN", "ARS",
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(v: unknown): v is SupportedCurrency {
  return typeof v === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(v);
}

/** Returns a Zod-compatible enum schema string for documentation. */
export const SUPPORTED_CURRENCIES_HUMAN = SUPPORTED_CURRENCIES.join(", ");
