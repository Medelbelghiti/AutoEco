/**
 * Trip log: distance resolution, deduction arithmetic and the per-year summary.
 *
 * The rules these tests pin down are the ones a tax filing depends on, so the
 * important assertions are mostly about what the code refuses to do: never
 * invent a distance, never convert between km and miles, never add two
 * currencies together, and never carry a rate across a unit it was not set for.
 */
import { describe, it, expect } from "vitest";
import {
  resolveDistance,
  deductionCentsForTrip,
  summarizeTripsByYear,
  tripYears,
  tripCsvSection,
  MAX_TRIP_DISTANCE,
  type TripForMath,
} from "@/lib/trips";

describe("resolveDistance", () => {
  it("derives distance from an odometer pair", () => {
    const r = resolveDistance({ startOdometer: 10000, endOdometer: 10450 });
    expect(r).toEqual({ ok: true, distance: 450 });
  });

  it("accepts a plain distance when one is given", () => {
    const r = resolveDistance({ distance: 12.5 });
    expect(r).toEqual({ ok: true, distance: 12.5 });
  });

  it("refuses a contradicting pair instead of picking one", () => {
    // 450 from the odometer vs 90 typed in: silently preferring either would
    // produce a mileage figure the user never entered.
    const r = resolveDistance({ startOdometer: 10000, endOdometer: 10450, distance: 90 });
    expect(r).toMatchObject({ ok: false, code: "INCOMPLETE_ODOMETER" });
  });

  it("refuses a half-entered odometer pair", () => {
    const r = resolveDistance({ startOdometer: 10000 });
    expect(r).toMatchObject({ ok: false, code: "INCOMPLETE_ODOMETER" });
  });

  it("refuses when nothing was provided", () => {
    const r = resolveDistance({});
    expect(r).toMatchObject({ ok: false, code: "NO_DISTANCE" });
  });

  it("refuses an odometer that did not move forward", () => {
    const r = resolveDistance({ startOdometer: 10450, endOdometer: 10000 });
    expect(r).toMatchObject({ ok: false, code: "NON_POSITIVE_DISTANCE" });
  });

  it("refuses a zero-length trip", () => {
    // A row that claims a distance of zero contributes nothing to a mileage
    // log but still occupies a quota slot and a year bucket.
    const r = resolveDistance({ distance: 0 });
    expect(r).toMatchObject({ ok: false, code: "NON_POSITIVE_DISTANCE" });
  });

  it("refuses a span that no real trip could cover", () => {
    const r = resolveDistance({ startOdometer: 0, endOdometer: MAX_TRIP_DISTANCE + 1 });
    expect(r).toMatchObject({ ok: false, code: "DISTANCE_TOO_LARGE" });
  });

  it("refuses more precision than a distance can carry into money arithmetic", () => {
    // Silently rounding here is how 0.1 + 0.2 problems end up on a tax document.
    const r = resolveDistance({ distance: 12.3456 });
    expect(r).toMatchObject({ ok: false, code: "TOO_PRECISE" });
  });

  it("keeps a two-decimal distance exactly", () => {
    const r = resolveDistance({ distance: 12.35 });
    expect(r).toEqual({ ok: true, distance: 12.35 });
  });
});

describe("deductionCentsForTrip", () => {
  const base: TripForMath = {
    date: new Date("2026-03-10T00:00:00Z"),
    purpose: "business",
    distance: 100,
    distanceUnit: "km",
    deductionRateCents: null,
    deductionCurrency: null,
  };

  it("applies the trip's own snapshot rate", () => {
    expect(deductionCentsForTrip({ ...base, deductionRateCents: 30 })).toBe(3000);
  });

  it("returns null when no rate was recorded", () => {
    // Null, not zero: "you had no rate" and "your rate was zero" are different
    // statements and the summary must not merge them.
    expect(deductionCentsForTrip({ ...base, deductionRateCents: null })).toBeNull();
  });

  it("returns null for a zero or absent distance", () => {
    expect(deductionCentsForTrip({ ...base, distance: null, deductionRateCents: 30 })).toBeNull();
    expect(deductionCentsForTrip({ ...base, distance: 0, deductionRateCents: 30 })).toBeNull();
  });

  it("handles a fractional distance without losing the cent", () => {
    expect(deductionCentsForTrip({ ...base, distance: 12.5, deductionRateCents: 30 })).toBe(375);
  });
});

describe("summarizeTripsByYear", () => {
  const trip = (over: Partial<Parameters<typeof summarizeTripsByYear>[0][number]>) =>
    ({
      date: new Date("2026-03-10T00:00:00Z"),
      purpose: "business",
      distance: 100,
      distanceUnit: "km",
      deductionRateCents: null,
      deductionCurrency: null,
      ...over,
    }) as Parameters<typeof summarizeTripsByYear>[0][number];

  it("groups by calendar year", () => {
    const s = summarizeTripsByYear([
      trip({ date: new Date("2025-12-31T23:59:59Z"), distance: 10 }),
      trip({ date: new Date("2026-01-01T00:00:00Z"), distance: 20 }),
    ]);
    expect([...s.keys()].sort()).toEqual([2025, 2026]);
    expect(s.get(2025)!.distance.km).toBe(10);
    expect(s.get(2026)!.distance.km).toBe(20);
  });

  it("uses UTC, so a late-December trip is not filed into the next year", () => {
    // 23:30 UTC on the 31st is already the next day for some users; using UTC
    // everywhere keeps one trip in exactly one bucket for all of them.
    const s = summarizeTripsByYear([trip({ date: new Date("2026-12-31T23:30:00Z") })]);
    expect(s.has(2026)).toBe(true);
    expect(s.has(2027)).toBe(false);
  });

  it("keeps km and miles in separate buckets instead of converting", () => {
    const s = summarizeTripsByYear([
      trip({ distance: 100, distanceUnit: "km" }),
      trip({ distance: 100, distanceUnit: "mi" }),
    ]);
    const y = s.get(2026)!;
    expect(y.distance).toEqual({ km: 100, mi: 100 });
    // 100 km is 62.1 mi; adding them would invent a number.
    expect(y.distance.km).toBe(100);
  });

  it("separates deductions by currency, unit and rate", () => {
    const s = summarizeTripsByYear([
      trip({ distance: 100, deductionRateCents: 30, deductionCurrency: "EUR" }),
      trip({ distance: 100, deductionRateCents: 30, deductionCurrency: "USD" }),
      trip({ distance: 100, deductionRateCents: 45, deductionCurrency: "EUR" }),
    ]);
    const d = s.get(2026)!.deductions;
    expect(d).toHaveLength(3);
    expect(d.reduce((sum, x) => sum + x.amountCents, 0)).toBe(3000 + 3000 + 4500);
  });

  it("never adds deductions across currencies", () => {
    const s = summarizeTripsByYear([
      trip({ distance: 100, deductionRateCents: 30, deductionCurrency: "EUR" }),
      trip({ distance: 100, deductionRateCents: 30, deductionCurrency: "USD" }),
    ]);
    const keys = s.get(2026)!.deductions.map((d) => d.currency).sort();
    expect(keys).toEqual(["EUR", "USD"]);
  });

  it("keeps one bucket per purpose per year, even when purposes interleave", () => {
    // The order matters: an implementation that keyed purposes by year alone
    // would emit "business" twice here.
    const s = summarizeTripsByYear([
      trip({ purpose: "business", distance: 10 }),
      trip({ purpose: "personal", distance: 20 }),
      trip({ purpose: "business", distance: 30 }),
    ]);
    const y = s.get(2026)!;
    expect(y.byPurpose.map((p) => p.purpose).sort()).toEqual(["business", "personal"]);
    const business = y.byPurpose.find((p) => p.purpose === "business")!;
    expect(business.tripCount).toBe(2);
    expect(business.distance.km).toBe(40);
  });

  it("counts trips even when no distance was recorded", () => {
    const s = summarizeTripsByYear([trip({ distance: null })]);
    const y = s.get(2026)!;
    expect(y.tripCount).toBe(1);
    expect(y.distance).toEqual({});
  });

  it("returns nothing for an empty log", () => {
    expect(summarizeTripsByYear([]).size).toBe(0);
    expect(tripYears([])).toEqual([]);
  });
});

describe("tripCsvSection", () => {
  it("exports one row per trip with a derived year and deduction", () => {
    const { columns, rows } = tripCsvSection(
      [
        {
          id: "t1",
          vehicleId: "v1",
          date: new Date("2026-04-02T00:00:00Z"),
          purpose: "business",
          distance: 250,
          distanceUnit: "km",
          startOdometer: 1000,
          endOdometer: 1250,
          deductionRateCents: 30,
          deductionCurrency: "EUR",
          note: "Client visit",
          createdAt: new Date("2026-04-02T10:00:00Z"),
        },
      ],
      () => "My Car"
    );
    expect(columns).toContain("deductionAmountCents");
    expect(rows[0][columns.indexOf("year")]).toBe(2026);
    expect(rows[0][columns.indexOf("deductionAmountCents")]).toBe(7500);
    expect(rows[0][columns.indexOf("vehicle")]).toBe("My Car");
  });

  it("leaves the derived amount blank when no rate was recorded", () => {
    const { columns, rows } = tripCsvSection(
      [
        {
          id: "t2",
          vehicleId: "v1",
          date: new Date("2026-04-03T00:00:00Z"),
          purpose: "personal",
          distance: 10,
          distanceUnit: "km",
          startOdometer: null,
          endOdometer: null,
          deductionRateCents: null,
          deductionCurrency: null,
          note: null,
          createdAt: new Date("2026-04-03T10:00:00Z"),
        },
      ],
      () => "My Car"
    );
    expect(rows[0][columns.indexOf("deductionAmountCents")]).toBeNull();
  });
});