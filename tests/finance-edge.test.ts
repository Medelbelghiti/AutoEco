import { describe, it, expect } from "vitest";
import { summarizeExpenses, computeDepreciation, projectCost, trueOwnershipCost } from "@/lib/finance";

describe("financial engine edge cases", () => {
  it("handles zero-mileage gracefully", () => {
    const s = summarizeExpenses([{ amountCents: 10000, currency: "USD", date: new Date("2026-01-15"), category: "fuel" }], [], "USD");
    expect(s.costPerKm).toBeNull();
    expect(s.totalDistance).toBeNull();
    expect(s.missingDistance).toBe(true);
  });

  it("never produces NaN or Infinity for empty inputs", () => {
    const s = summarizeExpenses([], [], "EUR");
    expect(Number.isFinite(s.totalSpent)).toBe(true);
    expect(Number.isFinite(s.monthlyAverage)).toBe(true);
    expect(Number.isFinite(s.annualEstimate)).toBe(true);
    expect(s.costPerKm).toBeNull();
  });

  it("computes cost/km from two fuel entries (10000 cents / 500 km = 20 cents/km)", () => {
    const fuel = [
      { date: new Date("2026-01-01"), amountCents: 5000, currency: "USD", liters: 40, mileage: 10000, fullTank: true },
      { date: new Date("2026-02-01"), amountCents: 5000, currency: "USD", liters: 40, mileage: 10500, fullTank: true },
    ];
    const s = summarizeExpenses([], fuel, "USD");
    expect(s.totalDistance).toBe(500);
    expect(s.costPerKm).toBe(20);
  });

  it("depreciation returns zeros safely when no purchase price", () => {
    const d = computeDepreciation({ purchasePriceCents: 0, purchaseDate: new Date(), currentResaleCents: null });
    expect(d.method).toBe("straight-line-20pct");
    expect(d.totalDepreciationCents).toBe(0);
  });

  it("projection with negative inflation stays positive", () => {
    const summary = summarizeExpenses([{ amountCents: 5000, currency: "USD", date: new Date("2026-01-01"), category: "fuel" }], [], "USD");
    const f = projectCost(summary, 36, { monthlyInflationPct: -0.5 });
    expect(f.total).toBeGreaterThan(0);
    expect(Number.isFinite(f.total)).toBe(true);
  });

  it("trueOwnershipCost with missing data returns zeros", () => {
    const summary = summarizeExpenses([], [], "USD");
    const t = trueOwnershipCost(summary, { purchasePriceCents: 0, purchaseDate: new Date(), estimatedResaleCents: null }, 12);
    expect(t.total).toBe(0);
  });

  it("rounding behaviour consistent (integer cents)", () => {
    const s = summarizeExpenses([{ amountCents: 999, currency: "USD", date: new Date("2026-01-01"), category: "fuel" }], [], "USD");
    expect(s.totalSpent).toBe(999);
    expect(s.monthlyAverage).toBe(999);
    expect(Number.isInteger(s.monthlyAverage)).toBe(true);
  });
});
