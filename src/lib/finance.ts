/**
 * AutoEco financial engine.
 *
 * Pure functions: testable in isolation, free of UI dependencies.
 *
 * Three categories of output:
 *   - ACTUAL: derived from the user's real recorded expenses
 *   - ESTIMATE: derived from external or catalog reference data
 *   - FORECAST: projection into the future based on ACTUAL + assumptions
 *
 * Currency integrity:
 *   - Every aggregation operates on amounts in the SAME currency.
 *   - When entries with different currencies are present, summarizeExpenses
 *     returns a CurrencyMismatch error and the caller MUST convert or
 *     refuse to display a total. We do NOT silently mix currencies.
 */

export type Category =
  | "fuel" | "maintenance" | "repair" | "insurance" | "tax"
  | "registration" | "tires" | "parking" | "tolls" | "cleaning"
  | "accessories" | "financing" | "charging" | "other";

export const ALLOWED_CATEGORIES: Category[] = [
  "fuel", "maintenance", "repair", "insurance", "tax",
  "registration", "tires", "parking", "tolls", "cleaning",
  "accessories", "financing", "charging", "other",
];

// Re-export from the canonical location so existing imports keep working.
export { SUPPORTED_CURRENCIES as ALLOWED_CURRENCIES, type SupportedCurrency, isSupportedCurrency } from "./currency";
import { isSupportedCurrency as _isc } from "./currency";
const isSupportedCurrency = _isc;

export const ALLOWED_DISTANCE_UNITS = ["km", "mi"] as const;
export type DistanceUnit = typeof ALLOWED_DISTANCE_UNITS[number];

export const ALLOWED_FUEL_UNITS = ["L_PER_100KM", "KM_PER_L", "MPG"] as const;
export type FuelEconomyUnit = typeof ALLOWED_FUEL_UNITS[number];

export interface RawExpense {
  amountCents: number;
  currency: string;
  date: Date;
  category: string;
  mileage?: number | null;
}

export interface RawFuelEntry {
  date: Date;
  amountCents: number;
  currency: string;
  liters?: number | null;
  kwh?: number | null;
  mileage: number;
  fullTank: boolean;
}

export interface CostSummary {
  totalSpent: number;
  totalFuel: number;
  totalMaintenance: number;
  totalRepair: number;
  totalInsurance: number;
  totalOther: number;
  totalDistance: number | null;
  monthsOfData: number;
  monthlyAverage: number;
  annualEstimate: number;
  costPerKm: number | null;
  costPerMile: number | null;
  missingDistance: boolean;
  /** ACTUAL breakdown by category — every category the user recorded. */
  breakdown: { category: string; amount: number; percent: number }[];
  /** The currency these totals are in. */
  baseCurrency: string;
  /** Set to true if mixed currencies were filtered out. */
  mixedCurrencyDetected: boolean;
}

export class CurrencyMismatchError extends Error {
  currencies: string[];
  constructor(currencies: string[]) {
    super(`Cannot aggregate across currencies: ${Array.from(new Set(currencies)).join(", ")}. Convert or filter before calling.`);
    this.currencies = currencies;
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Validate numeric inputs. Returns an error message if invalid.
 * Prevents NaN / Infinity from leaking into financial outputs.
 */
function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Non-finite ${label}: ${value}`);
  if (value < 0 && !["estimatedResale", "currentMileage"].includes(label)) {
    throw new Error(`Negative ${label}: ${value}`);
  }
}

/**
 * Normalize a category string. Unknown categories fall back to "other"
 * (never silently dropped) and the caller can see the resulting bucket.
 */
export function normalizeCategory(c: string): Category {
  const v = c.toLowerCase().trim();
  return (ALLOWED_CATEGORIES as string[]).includes(v) ? (v as Category) : "other";
}

/**
 * Aggregate expenses + fuel into a per-category summary.
 * STRICTLY operates on a single currency. If multiple currencies are
 * present, throws CurrencyMismatchError — the caller MUST handle it.
 */
export function summarizeExpenses(
  expenses: RawExpense[],
  fuel: RawFuelEntry[],
  baseCurrency: string
): CostSummary {
  if (!isSupportedCurrency(baseCurrency)) {
    throw new Error(`Unsupported base currency: ${baseCurrency}`);
  }

  // Detect mixed currencies before aggregating anything
  const currencies = new Set<string>([baseCurrency]);
  for (const e of expenses) {
    if (!e.currency) throw new Error(`Expense missing currency`);
    currencies.add(e.currency);
  }
  for (const f of fuel) {
    if (!f.currency) throw new Error(`Fuel entry missing currency`);
    currencies.add(f.currency);
  }
  const mixedCurrencyDetected = currencies.size > 1;
  if (mixedCurrencyDetected) {
    throw new CurrencyMismatchError(Array.from(currencies));
  }

  let totalFuel = 0;
  let totalMaintenance = 0;
  let totalRepair = 0;
  let totalInsurance = 0;
  let totalOther = 0;
  let totalDistance: number | null = null;
  const monthsSet = new Set<string>();

  for (const e of expenses) {
    assertFiniteNumber(e.amountCents, "expense.amountCents");
    monthsSet.add(yyyymm(e.date));
    switch (normalizeCategory(e.category)) {
      case "fuel": case "charging": totalFuel += e.amountCents; break;
      case "maintenance": totalMaintenance += e.amountCents; break;
      case "repair": totalRepair += e.amountCents; break;
      case "insurance": case "tax": case "registration": case "financing": totalInsurance += e.amountCents; break;
      case "parking": case "tolls": case "cleaning": case "tires": case "accessories": totalOther += e.amountCents; break;
      case "other": totalOther += e.amountCents; break;
    }
  }
  for (const f of fuel) {
    assertFiniteNumber(f.amountCents, "fuel.amountCents");
    if (f.mileage < 0) throw new Error("Negative mileage");
    monthsSet.add(yyyymm(f.date));
    totalFuel += f.amountCents;
  }

  const monthsOfData = monthsSet.size || 1;
  const totalSpent = totalFuel + totalMaintenance + totalRepair + totalInsurance + totalOther;
  assertFiniteNumber(totalSpent, "totalSpent");
  const monthlyAverage = Math.round(totalSpent / monthsOfData);
  const annualEstimate = monthlyAverage * 12;

  // Distance from expense mileages
  const mileages = expenses.map((e) => e.mileage ?? 0).filter((m) => m > 0) as number[];
  if (mileages.length >= 2) {
    const min = Math.min(...mileages);
    const max = Math.max(...mileages);
    if (max >= min) totalDistance = max - min;
  }
  // Distance from fuel entries (only if not already known)
  if (totalDistance == null && fuel.length >= 2) {
    const sorted = [...fuel].sort((a, b) => +a.date - +b.date);
    const dist = sorted[sorted.length - 1].mileage - sorted[0].mileage;
    if (dist >= 0) totalDistance = dist;
  }
  // Reject impossible distance values
  if (totalDistance != null && totalDistance < 0) totalDistance = 0;

  const costPerKm = totalDistance && totalDistance > 0 ? Math.round(totalSpent / totalDistance) : null;
  const costPerMile = costPerKm != null ? Math.round(costPerKm * 1.609344) : null;

  const totalForBreakdown = Math.max(1, totalSpent);
  const breakdown = [
    { category: "fuel" as const, amount: totalFuel, percent: Math.round((totalFuel / totalForBreakdown) * 100) },
    { category: "maintenance" as const, amount: totalMaintenance, percent: Math.round((totalMaintenance / totalForBreakdown) * 100) },
    { category: "repair" as const, amount: totalRepair, percent: Math.round((totalRepair / totalForBreakdown) * 100) },
    { category: "insurance" as const, amount: totalInsurance, percent: Math.round((totalInsurance / totalForBreakdown) * 100) },
    { category: "other" as const, amount: totalOther, percent: Math.round((totalOther / totalForBreakdown) * 100) },
  ].sort((a, b) => b.amount - a.amount);

  return {
    totalSpent, totalFuel, totalMaintenance, totalRepair, totalInsurance, totalOther,
    totalDistance, monthsOfData, monthlyAverage, annualEstimate, costPerKm, costPerMile,
    missingDistance: totalDistance == null, breakdown,
    baseCurrency,
    mixedCurrencyDetected: false,
  };
}

function yyyymm(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Money for display.
 *
 * `tag` is a BCP-47 locale tag from `intlLocale()`; it only changes how the
 * digits are grouped and where the decimal separator sits. The currency
 * always comes from the caller — it is the user's own setting — so choosing a
 * language can never change which currency a figure is reported in. The
 * default keeps the historic `en-US` output for call sites (and tests) that
 * have no request locale to pass.
 */
export function formatMoney(cents: number, currency = "USD", tag = "en-US"): string {
  const cur = isSupportedCurrency(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat(tag, { style: "currency", currency: cur.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

export interface Forecast {
  monthlyAverage: number;
  horizonMonths: number;
  total: number;
  currency: string;
  assumptions: string[];
}

export function projectCost(
  summary: CostSummary,
  horizonMonths: number,
  opts: { monthlyInflationPct?: number } = {}
): Forecast {
  if (!Number.isInteger(horizonMonths) || horizonMonths <= 0 || horizonMonths > 600) {
    throw new Error(`Invalid horizonMonths: ${horizonMonths}`);
  }
  const inflation = opts.monthlyInflationPct ?? 0;
  if (!Number.isFinite(inflation) || inflation < -0.5 || inflation > 1) {
    throw new Error(`Invalid inflation: ${inflation}`);
  }
  let total = 0;
  const assumptions: string[] = [
    `Based on ${summary.monthsOfData} months of ACTUAL recorded data`,
    `Monthly average (ACTUAL): ${formatMoney(summary.monthlyAverage, summary.baseCurrency)}`,
  ];
  if (inflation > 0) {
    let running = summary.monthlyAverage;
    for (let m = 1; m <= horizonMonths; m++) {
      running = Math.round(running * (1 + inflation));
      total += running;
    }
    assumptions.push(`${(inflation * 100).toFixed(2)}% monthly cost inflation assumed`);
  } else if (inflation < 0) {
    let running = summary.monthlyAverage;
    for (let m = 1; m <= horizonMonths; m++) {
      running = Math.round(running * (1 + inflation));
      if (running < 0) running = 0;
      total += running;
    }
    assumptions.push(`${Math.abs(inflation * 100).toFixed(2)}% monthly deflation assumed`);
  } else {
    total = summary.monthlyAverage * horizonMonths;
    assumptions.push("No monthly inflation assumed (flat projection)");
  }
  if (!Number.isFinite(total) || total < 0) total = 0;
  return {
    monthlyAverage: summary.monthlyAverage,
    horizonMonths,
    total,
    currency: summary.baseCurrency,
    assumptions,
  };
}

export interface DepreciationInputs {
  purchasePriceCents: number;
  purchaseDate: Date;
  currentResaleCents?: number | null;
  yearsOwned?: number;
}

export interface DepreciationResult {
  currentValueCents: number | null;
  totalDepreciationCents: number;
  perYearCents: number | null;
  method: "user-provided" | "straight-line-20pct";
  note: string;
}

export function computeDepreciation(input: DepreciationInputs, now: Date = new Date()): DepreciationResult {
  if (input.purchasePriceCents < 0) throw new Error("Negative purchase price");
  if (input.purchaseDate > now) throw new Error("Future purchase date");
  if (input.currentResaleCents != null && input.currentResaleCents < 0) {
    throw new Error("Negative resale");
  }

  const years = input.yearsOwned ?? yearsBetween(input.purchaseDate, now);

  if (input.currentResaleCents != null && input.currentResaleCents > 0) {
    const total = Math.max(0, input.purchasePriceCents - input.currentResaleCents);
    return {
      currentValueCents: input.currentResaleCents,
      totalDepreciationCents: total,
      perYearCents: years > 0 ? Math.round(total / years) : null,
      method: "user-provided",
      note: "Based on the resale value you provided.",
    };
  }
  const remainingPct = Math.max(0, 1 - 0.2 * years);
  const currentValue = Math.round(input.purchasePriceCents * remainingPct);
  const total = Math.max(0, input.purchasePriceCents - currentValue);
  return {
    currentValueCents: currentValue,
    totalDepreciationCents: total,
    perYearCents: years > 0 ? Math.round(total / years) : null,
    method: "straight-line-20pct",
    note: "Straight-line 20% per year estimate. Provide your own resale value for accuracy.",
  };
}

function yearsBetween(a: Date, b: Date): number {
  if (a > b) return 0;
  return Math.max(0, (+b - +a) / (365.25 * 24 * 60 * 60 * 1000));
}

export function estimateCO2Kg(opts: { liters?: number; kwh?: number; gridFactor?: number }): number {
  if (opts.liters != null) return Math.round(opts.liters * 2.31 * 100) / 100;
  if (opts.kwh != null) return Math.round(opts.kwh * (opts.gridFactor ?? 0.4) * 100) / 100;
  return 0;
}

/**
 * True cost of ownership.
 *
 * IMPORTANT: this function NEVER double-counts. The category-level totals
 * from the ACTUAL `summary` are the only source for operating costs.
 * `monthlyFixedCents` is reserved for *future fixed costs* the user
 * expects to pay (e.g. an upcoming insurance premium) and is explicitly
 * NOT derived from already-recorded ACTUAL expenses.
 *
 * Each category that the user has already recorded contributes via
 * `summary.monthlyAverage` (already an average). We then ADD:
 *   - any *forward-looking* fixed costs (e.g. next-year insurance)
 *   - depreciation
 *
 * If a caller mistakenly passes fixed costs that overlap with ACTUAL
 * recorded categories, we DOCUMENT the overlap in assumptions rather
 * than silently inflating the total.
 */
export interface CostInputs {
  purchasePriceCents: number;
  purchaseDate: Date;
  estimatedResaleCents: number | null;
  /** Forward-looking monthly fixed costs (insurance/tax). MUST NOT overlap with ACTUAL recorded categories. */
  forwardLookingFixedCents?: number;
  forwardLookingFixedLabel?: string;
}

/**
 * Stable identifiers for true-cost breakdown rows. The engine NEVER emits
 * English label text: renderers map an id to a localized key via
 * `trueCostRowKey` (see below).
 */
export type TrueCostRowId = "operating" | "forwardFixed" | "depreciation";
export type TrueCostSource = "actual" | "estimate" | "forecast";

export interface TrueCostRow {
  id: TrueCostRowId;
  cents: number;
  source: TrueCostSource;
}

/** Map a true-cost breakdown row id to the i18n key holding its label. */
export function trueCostRowKey(id: TrueCostRowId): string {
  switch (id) {
    case "operating":
      return "twin.breakdown_operating";
    case "forwardFixed":
      return "twin.breakdown_forward_fixed";
    case "depreciation":
      return "twin.breakdown_depreciation";
  }
}

export function trueOwnershipCost(
  summary: CostSummary,
  inputs: CostInputs,
  horizonMonths: number,
  now: Date = new Date()
): { total: number; currency: string; breakdown: TrueCostRow[]; assumptions: string[] } {
  const depreciation = computeDepreciation(inputs, now);
  // Project operating cost forward, but only for categories the user actually recorded.
  const projectedOperating = summary.monthlyAverage * horizonMonths;
  const forwardFixed = (inputs.forwardLookingFixedCents ?? 0) * horizonMonths;

  const total = projectedOperating + forwardFixed + depreciation.totalDepreciationCents;

  const assumptions: string[] = [
    `Operating cost projection: ${formatMoney(summary.monthlyAverage, summary.baseCurrency)}/month average × ${horizonMonths} months (ACTUAL monthly average).`,
    `This includes ALL recorded categories: ${summary.breakdown.map((b) => b.category).join(", ")}.`,
    `Forward-looking fixed cost: ${formatMoney(inputs.forwardLookingFixedCents ?? 0, summary.baseCurrency)}/month × ${horizonMonths} months${inputs.forwardLookingFixedLabel ? ` (${inputs.forwardLookingFixedLabel})` : ""}.`,
    `Depreciation (ESTIMATE): ${formatMoney(depreciation.totalDepreciationCents, summary.baseCurrency)} via ${depreciation.method}.`,
  ];
  if (depreciation.method === "straight-line-20pct") {
    assumptions.push(depreciation.note);
  }

  return {
    total,
    currency: summary.baseCurrency,
    breakdown: [
      { id: "operating", cents: projectedOperating, source: "forecast" },
      { id: "forwardFixed", cents: forwardFixed, source: "forecast" },
      { id: "depreciation", cents: depreciation.totalDepreciationCents, source: "estimate" },
    ],
    assumptions,
  };
}
