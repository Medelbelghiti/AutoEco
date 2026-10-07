/**
 * Regression tests for the FINANCIAL DOUBLE-COUNTING bug.
 *
 * The old `trueOwnershipCost` accepted a `monthlyFixedCents` that was
 * ADDED on top of `monthlyAverage`, which already included insurance/tax.
 * This silently double-counted insurance/tax.
 *
 * The fix renames it to `forwardLookingFixedCents` and adds explicit
 * ASSUMPTIONS so callers understand the overlap risk.
 *
 * These tests prove the math:
 *   monthlyAverage (in cents) — covers ACTUAL recorded categories
 *   forwardLookingFixedCents (in cents/month) — ONLY added when caller
 *     knows it's a forward-looking cost NOT already in monthlyAverage
 */
import { describe, it, expect } from "vitest";
import { summarizeExpenses, trueOwnershipCost } from "@/lib/finance";

const ACTUAL = [
  { amountCents: 50000, currency: "USD", date: new Date("2026-01-15"), category: "fuel" },
  { amountCents: 30000, currency: "USD", date: new Date("2026-01-20"), category: "maintenance" },
  { amountCents: 120000, currency: "USD", date: new Date("2026-02-05"), category: "insurance" },
  { amountCents: 40000, currency: "USD", date: new Date("2026-02-10"), category: "parking", mileage: 2500 },
];

describe("trueOwnershipCost double-counting guard", () => {
  it("does NOT add forward fixed on top of ACTUAL operating cost by default", () => {
    const summary = summarizeExpenses(ACTUAL, [], "USD");
    // monthlyAverage = (50+30+120+40)/2 = 120000 cents
    expect(summary.monthlyAverage).toBe(120000);
    const t = trueOwnershipCost(summary, {
      purchasePriceCents: 2000000,
      purchaseDate: new Date("2022-01-01"),
      estimatedResaleCents: 1400000,
    }, 36);
    // No forward fixed → operating alone: 120000 * 36 = 4_320_000
    expect(t.breakdown.find((b) => b.id === "operating")!.cents).toBe(4_320_000);
    expect(t.breakdown.find((b) => b.id === "forwardFixed")!.cents).toBe(0);
  });

  it("ADDs forward fixed ONLY when explicitly passed (caller accepts the overlap)", () => {
    const summary = summarizeExpenses(ACTUAL, [], "USD");
    const t = trueOwnershipCost(summary, {
      purchasePriceCents: 2000000,
      purchaseDate: new Date("2022-01-01"),
      estimatedResaleCents: 1400000,
      forwardLookingFixedCents: 10000,
      forwardLookingFixedLabel: "Insurance renewal",
    }, 36);
    // Forward fixed explicitly: 10_000 * 36 = 360_000
    expect(t.breakdown.find((b) => b.id === "forwardFixed")!.cents).toBe(360_000);
    // The breakdown DOCUMENTATION mentions that this overlaps with recorded insurance.
    const hasOverlapNote = t.assumptions.some((a) => a.includes("Forward-looking fixed"));
    expect(hasOverlapNote).toBe(true);
  });

  it("records operating-cost line as FORECAST (not ACTUAL)", () => {
    const summary = summarizeExpenses(ACTUAL, [], "USD");
    const t = trueOwnershipCost(summary, {
      purchasePriceCents: 2000000,
      purchaseDate: new Date("2022-01-01"),
      estimatedResaleCents: 1400000,
    }, 36);
    const operating = t.breakdown.find((b) => b.id === "operating")!;
    expect(operating.source).toBe("forecast");
  });

  it("records depreciation as ESTIMATE", () => {
    const summary = summarizeExpenses(ACTUAL, [], "USD");
    const t = trueOwnershipCost(summary, {
      purchasePriceCents: 2000000,
      purchaseDate: new Date("2022-01-01"),
      estimatedResaleCents: 1400000,
    }, 36);
    const dep = t.breakdown.find((b) => b.id === "depreciation")!;
    expect(dep.source).toBe("estimate");
  });
});
