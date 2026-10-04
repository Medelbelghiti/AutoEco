/**
 * Canonical plan definitions — single source of truth.
 *
 * Imported by `prisma/seed.ts` (full seed) and by `scripts/seed-plans.ts`
 * (plans-only remediation that can be run against production without touching
 * users or demo data).
 *
 * Keeping these in one module is deliberate: a second hand-maintained copy of
 * the plan matrix is how pricing and entitlements drift apart, and how a
 * production database ends up with plans the code does not expect.
 *
 * Prices are ALWAYS quoted in USD. The `currency` column default is the
 * lowercase "usd", so it is set explicitly to match the uppercase
 * SUPPORTED_CURRENCIES list used for user-entered amounts.
 */
export const PLAN_CURRENCY = "USD";

export interface PlanDefinition {
  key: string;
  name: string;
  description: string;
  priceCents: number;
  billingPeriod: "FREE" | "MONTHLY" | "YEARLY";
  maxVehicles: number;
  maxExpensesPerMonth: number;
  aiReceiptScansPerMonth: number;
  aiConversationsPerMonth: number;
  reportRetentionDays: number;
  forecastHorizonMonths: number;
  enableAdvancedScenarios: boolean;
  enableShareableReports: boolean;
  enableFamilySharing: boolean;
  enableApiAccess: boolean;
  features: string[];
  sortOrder: number;
}

export const PLANS: PlanDefinition[] = [
  {
    key: "free",
    name: "Free",
    description: "Track one vehicle.",
    priceCents: 0,
    billingPeriod: "FREE",
    maxVehicles: 1,
    maxExpensesPerMonth: 50,
    aiReceiptScansPerMonth: 0,
    aiConversationsPerMonth: 0,
    reportRetentionDays: 30,
    forecastHorizonMonths: 12,
    enableAdvancedScenarios: false,
    enableShareableReports: false,
    enableFamilySharing: false,
    enableApiAccess: false,
    features: ["1 vehicle", "Expense tracking"],
    sortOrder: 0,
  },
  {
    key: "pro",
    name: "Pro",
    description: "Multi-vehicle + AI.",
    priceCents: 699,
    billingPeriod: "MONTHLY",
    maxVehicles: 5,
    maxExpensesPerMonth: 1000,
    aiReceiptScansPerMonth: 50,
    aiConversationsPerMonth: 100,
    reportRetentionDays: 365,
    forecastHorizonMonths: 60,
    enableAdvancedScenarios: true,
    enableShareableReports: true,
    enableFamilySharing: false,
    enableApiAccess: false,
    features: ["Up to 5 vehicles", "AI receipt scan", "Financial Twin"],
    sortOrder: 1,
  },
  {
    key: "family",
    name: "Family",
    description: "For households.",
    priceCents: 1299,
    billingPeriod: "MONTHLY",
    maxVehicles: 12,
    maxExpensesPerMonth: 2500,
    aiReceiptScansPerMonth: 200,
    aiConversationsPerMonth: 300,
    reportRetentionDays: 730,
    forecastHorizonMonths: 60,
    enableAdvancedScenarios: true,
    enableShareableReports: true,
    enableFamilySharing: true,
    enableApiAccess: false,
    features: ["Up to 12 vehicles", "Family sharing"],
    sortOrder: 2,
  },
  {
    key: "pro_plus",
    name: "Pro Plus",
    description: "Power users + API.",
    priceCents: 1999,
    billingPeriod: "MONTHLY",
    maxVehicles: 50,
    maxExpensesPerMonth: 10000,
    aiReceiptScansPerMonth: 1000,
    aiConversationsPerMonth: 1000,
    reportRetentionDays: 3650,
    forecastHorizonMonths: 120,
    enableAdvancedScenarios: true,
    enableShareableReports: true,
    enableFamilySharing: true,
    enableApiAccess: true,
    features: ["Up to 50 vehicles", "API access"],
    sortOrder: 3,
  },
];

/** The shape accepted by `prisma.plan.upsert` for both branches. */
export function planRow(p: PlanDefinition): Record<string, unknown> {
  return {
    key: p.key,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: PLAN_CURRENCY,
    billingPeriod: p.billingPeriod,
    maxVehicles: p.maxVehicles,
    maxExpensesPerMonth: p.maxExpensesPerMonth,
    aiReceiptScansPerMonth: p.aiReceiptScansPerMonth,
    aiConversationsPerMonth: p.aiConversationsPerMonth,
    reportRetentionDays: p.reportRetentionDays,
    forecastHorizonMonths: p.forecastHorizonMonths,
    enableAdvancedScenarios: p.enableAdvancedScenarios,
    enableShareableReports: p.enableShareableReports,
    enableFamilySharing: p.enableFamilySharing,
    enableApiAccess: p.enableApiAccess,
    features: JSON.stringify(p.features),
    sortOrder: p.sortOrder,
  };
}