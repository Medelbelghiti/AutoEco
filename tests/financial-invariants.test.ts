/**
 * Financial invariant regression tests.
 * Property-style: assert that no matter what inputs the engine receives,
 * its outputs respect core invariants (no NaN, no Infinity, no negatives
 * for non-decreasing fields, mixed-currency is never silently summed).
 */
import { describe, it, expect } from "vitest";
import { summarizeExpenses, computeDepreciation, projectCost, trueOwnershipCost, CurrencyMismatchError } from "@/lib/finance";

describe("financial engine invariants", () => {
  it("totalSpent is always >= 0 for any non-negative inputs", () => {
    for (const amounts of [[0], [100], [1000000], [0, 0, 0]]) {
      const s = summarizeExpenses(
        amounts.map((a) => ({ amountCents: a, currency: "USD", date: new Date("2026-01-15"), category: "fuel" })),
        [], "USD"
      );
      expect(s.totalSpent).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.totalSpent)).toBe(true);
    }
  });

  it("totals are never NaN or Infinity", () => {
    const s = summarizeExpenses([
      { amountCents: 12345, currency: "USD", date: new Date("2026-01-15"), category: "fuel", mileage: 100 },
      { amountCents: 50000, currency: "USD", date: new Date("2026-02-15"), category: "insurance" },
    ], [], "USD");
    for (const k of ["totalSpent", "monthlyAverage", "annualEstimate", "costPerKm", "totalFuel", "totalMaintenance", "totalRepair", "totalInsurance", "totalOther"] as const) {
      const v = s[k];
      if (v === null) continue;
      expect(Number.isFinite(v as number)).toBe(true);
    }
  });

  it("percentages always sum to 100 (within rounding)", () => {
    const s = summarizeExpenses([
      { amountCents: 25000, currency: "USD", date: new Date("2026-01-15"), category: "fuel" },
      { amountCents: 25000, currency: "USD", date: new Date("2026-02-15"), category: "maintenance" },
      { amountCents: 25000, currency: "USD", date: new Date("2026-03-15"), category: "insurance" },
      { amountCents: 25000, currency: "USD", date: new Date("2026-04-15"), category: "parking" },
    ], [], "USD");
    const sum = s.breakdown.reduce((acc, b) => acc + b.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(4); // rounding tolerance
  });

  it("cost per km is never negative", () => {
    const s = summarizeExpenses([
      { amountCents: 10000, currency: "USD", date: new Date("2026-01-15"), category: "fuel", mileage: 100 },
      { amountCents: 10000, currency: "USD", date: new Date("2026-02-15"), category: "fuel", mileage: 500 },
    ], [], "USD");
    if (s.costPerKm !== null) expect(s.costPerKm).toBeGreaterThanOrEqual(0);
  });

  it("depreciation is never negative for non-negative inputs", () => {
    const d1 = computeDepreciation({ purchasePriceCents: 2000000, purchaseDate: new Date("2022-01-01"), currentResaleCents: 1500000 });
    expect(d1.totalDepreciationCents).toBeGreaterThanOrEqual(0);
    const d2 = computeDepreciation({ purchasePriceCents: 1000000, purchaseDate: new Date("2022-01-01") });
    expect(d2.totalDepreciationCents).toBeGreaterThanOrEqual(0);
  });

  it("forecast never changes historical actuals", () => {
    const s = summarizeExpenses([
      { amountCents: 10000, currency: "USD", date: new Date("2026-01-15"), category: "fuel" },
    ], [], "USD");
    const f = projectCost(s, 12);
    // The forecast is forward-looking; it should NOT include the historical amount.
    expect(f.assumptions.some((a) => a.includes("Based on"))).toBe(true);
    // The historical monthlyAverage is the average of recorded data only.
    expect(s.monthlyAverage).toBe(10000);
  });

  it("throws CurrencyMismatchError on mixed currencies — never silently sums", () => {
    expect(() => summarizeExpenses([
      { amountCents: 100, currency: "USD", date: new Date("2026-01-15"), category: "fuel" },
      { amountCents: 100, currency: "EUR", date: new Date("2026-01-15"), category: "fuel" },
    ], [], "USD")).toThrow(CurrencyMismatchError);
  });

  it("trueOwnershipCost does NOT double-count insurance/tax/maintenance", () => {
    // The bug being guarded: monthlyAverage INCLUDES insurance/tax, so
    // adding forwardLookingFixedCents on top would double-count.
    // The fix: forwardLookingFixedCents is for future costs NOT already
    // recorded. When not provided, it must be 0.
    //
    // All three entries in the SAME month → monthlyAverage = 80000 cents.
    const s = summarizeExpenses([
      { amountCents: 50000, currency: "USD", date: new Date("2026-01-15"), category: "insurance" },
      { amountCents: 20000, currency: "USD", date: new Date("2026-01-20"), category: "maintenance" },
      { amountCents: 10000, currency: "USD", date: new Date("2026-01-25"), category: "fuel" },
    ], [], "USD");
    expect(s.monthlyAverage).toBe(80000);
    const t = trueOwnershipCost(s, {
      purchasePriceCents: 2000000,
      purchaseDate: new Date("2022-01-01"),
      estimatedResaleCents: 1500000,
      // no forwardLookingFixedCents
    }, 12);
    // Operating alone: 80000 * 12 = 960000 (no double-count)
    const operating = t.breakdown.find((b) => b.id === "operating")!.cents;
    expect(operating).toBe(960000);
  });
});
