import { describe, it, expect } from "vitest";
import { summarizeExpenses, computeDepreciation, projectCost, formatMoney, estimateCO2Kg, trueOwnershipCost, CurrencyMismatchError } from "@/lib/finance";

describe("summarizeExpenses", () => {
  it("returns zero months data when nothing recorded", () => {
    const s = summarizeExpenses([], [], "USD");
    expect(s.totalSpent).toBe(0);
    expect(s.monthlyAverage).toBe(0);
    expect(s.costPerKm).toBeNull();
  });
  it("computes totals, average, and breakdown by category", () => {
    const expenses = [
      { amountCents: 5000, currency: "USD", date: new Date("2026-01-15"), category: "fuel", mileage: 1000 },
      { amountCents: 3000, currency: "USD", date: new Date("2026-01-20"), category: "maintenance" },
      { amountCents: 12000, currency: "USD", date: new Date("2026-02-05"), category: "insurance" },
      { amountCents: 4000, currency: "USD", date: new Date("2026-02-10"), category: "parking", mileage: 2500 },
    ];
    const s = summarizeExpenses(expenses, [], "USD");
    expect(s.totalSpent).toBe(24000);
    expect(s.monthsOfData).toBe(2);
    expect(s.monthlyAverage).toBe(12000);
    expect(s.totalDistance).toBe(1500);
    expect(s.costPerKm).toBe(16);
    expect(s.breakdown[0].category).toBe("insurance");
  });
  it("aggregates fuel entries into the fuel bucket", () => {
    const s = summarizeExpenses([], [
      { date: new Date("2026-01-01"), amountCents: 6000, currency: "USD", liters: 40, mileage: 0, fullTank: true },
    ], "USD");
    expect(s.totalFuel).toBe(6000);
  });
  it("never fabricates missing data", () => {
    const s = summarizeExpenses([], [], "USD");
    expect(s.costPerKm).toBeNull();
    expect(s.totalDistance).toBeNull();
    expect(s.missingDistance).toBe(true);
  });
});

describe("computeDepreciation", () => {
  it("uses user-provided resale value when supplied", () => {
    const d = computeDepreciation({ purchasePriceCents: 2000000, purchaseDate: new Date("2022-01-01"), currentResaleCents: 1400000 });
    expect(d.method).toBe("user-provided");
    expect(d.totalDepreciationCents).toBe(600000);
  });
  it("falls back to 20% per year estimate when no resale provided", () => {
    const d = computeDepreciation({ purchasePriceCents: 2000000, purchaseDate: new Date("2021-01-01") });
    expect(d.method).toBe("straight-line-20pct");
    expect(d.note).toContain("20%");
  });
});

describe("projectCost", () => {
  it("projects with no inflation as flat monthly", () => {
    const summary = summarizeExpenses([{ amountCents: 120000, currency: "USD", date: new Date("2026-01-01"), category: "fuel" }], [], "USD");
    const f = projectCost(summary, 12);
    expect(f.horizonMonths).toBe(12);
    expect(f.total).toBe(summary.monthlyAverage * 12);
  });
  it("compounds monthly inflation", () => {
    const summary = summarizeExpenses([{ amountCents: 10000, currency: "USD", date: new Date("2026-01-01"), category: "fuel" }], [], "USD");
    const f = projectCost(summary, 3, { monthlyInflationPct: 0.1 });
    expect(f.assumptions.some((a) => a.includes("inflation"))).toBe(true);
    expect(f.total).toBeGreaterThan(summary.monthlyAverage * 3);
  });
});

describe("trueOwnershipCost", () => {
  it("labels forecast and estimate sources", () => {
    const summary = summarizeExpenses([{ amountCents: 60000, currency: "USD", date: new Date("2026-01-01"), category: "fuel" }], [], "USD");
    const t = trueOwnershipCost(summary, {
      purchasePriceCents: 2000000,
      purchaseDate: new Date("2022-01-01"),
      estimatedResaleCents: 1500000,
      forwardLookingFixedCents: 10000,
      forwardLookingFixedLabel: "Insurance",
    }, 12);
    const labels = t.breakdown.map((b) => b.source);
    expect(labels).toContain("forecast");
    expect(labels).toContain("estimate");
  });
});

describe("estimateCO2Kg", () => {
  it("estimates CO2 from liters", () => {
    expect(estimateCO2Kg({ liters: 50 })).toBeCloseTo(115.5, 1);
  });
  it("estimates CO2 from kWh", () => {
    expect(estimateCO2Kg({ kwh: 100 })).toBeGreaterThan(0);
  });
});

describe("formatMoney", () => {
  it("formats USD cents", () => {
    expect(formatMoney(123456)).toContain("1,234.56");
  });
  it("formats EUR", () => {
    expect(formatMoney(123456, "EUR")).toContain("\u20AC");
  });
});

describe("Currency integrity", () => {
  it("throws CurrencyMismatchError on mixed currencies", () => {
    expect(() => summarizeExpenses(
      [
        { amountCents: 1000, currency: "USD", date: new Date("2026-01-01"), category: "fuel" },
        { amountCents: 1000, currency: "EUR", date: new Date("2026-01-02"), category: "fuel" },
      ],
      [],
      "USD"
    )).toThrow(CurrencyMismatchError);
  });
  it("never produces NaN or Infinity for valid inputs", () => {
    const s = summarizeExpenses(
      [{ amountCents: 1000, currency: "USD", date: new Date("2026-01-01"), category: "fuel" }],
      [], "USD"
    );
    expect(Number.isFinite(s.totalSpent)).toBe(true);
    expect(Number.isFinite(s.monthlyAverage)).toBe(true);
    expect(s.totalSpent).toBe(1000);
  });
});
