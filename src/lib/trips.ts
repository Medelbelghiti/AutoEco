/**
 * Mileage / trip log (Phase 3.3).
 *
 * Pure functions only: no database, no request. Everything here is arithmetic
 * the user can check by hand, and every total is traceable to the rows that
 * produced it.
 *
 * The single most important rule in this file: WE NEVER INVENT A DEDUCTION
 * RATE. Mileage allowance rates differ by country, by tax year, by vehicle and
 * by whether the worker is an employee or self-employed, and they change. So a
 * trip only carries a deduction figure when the user supplied a rate, and the
 * rate is snapshotted onto the trip at that moment. If a user corrects their
 * rate in 2026, the 2024 trips they already filed keep the number they filed.
 * With no rate configured, this module reports distance and nothing else.
 *
 * For the same reason distances are never converted between km and miles:
 * the conversion factor would itself be an unsourced claim. Totals are grouped
 * by unit instead, and a user who mixes units sees two totals rather than a
 * fabricated combined one.
 */

export const TRIP_PURPOSES = [
  "business",
  "personal",
  "commute",
  "medical",
  "charity",
  "other",
] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

export const TRIP_DISTANCE_UNITS = ["km", "mi"] as const;
export type TripDistanceUnit = (typeof TRIP_DISTANCE_UNITS)[number];

/** Sanity ceiling: no real trip is longer than this. Catches typo'd odometers. */
export const MAX_TRIP_DISTANCE = 2_000_000;

export interface TripDistanceInput {
  startOdometer?: number | null;
  endOdometer?: number | null;
  distance?: number | null;
}

export type DistanceResolution =
  | { ok: true; distance: number }
  | { ok: false; code: TripDistanceErrorCode; error: string };

export type TripDistanceErrorCode =
  | "INCOMPLETE_ODOMETER"
  | "NO_DISTANCE"
  | "NON_POSITIVE_DISTANCE"
  | "DISTANCE_TOO_LARGE"
  | "TOO_PRECISE";

/** Round to 2 decimals without the float dust you get from `toFixed`. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Work out how far the trip was.
 *
 * Accepted either as an odometer pair (end minus start) or as a direct
 * distance. Mixing the two is rejected rather than silently preferring one:
 * an entry with a start odometer and a separate distance is ambiguous about
 * which reading the odometer will show next time.
 */
export function resolveDistance(input: TripDistanceInput): DistanceResolution {
  const { startOdometer, endOdometer, distance } = input;

  const hasStart = startOdometer !== null && startOdometer !== undefined;
  const hasEnd = endOdometer !== null && endOdometer !== undefined;
  const hasDistance = distance !== null && distance !== undefined;

  if (hasStart !== hasEnd) {
    return {
      ok: false,
      code: "INCOMPLETE_ODOMETER",
      error: "Give both the start and end odometer reading, or neither.",
    };
  }

  if (hasStart && hasEnd) {
    const start = startOdometer as number;
    const end = endOdometer as number;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { ok: false, code: "NO_DISTANCE", error: "Odometer readings must be numbers." };
    }
    if (end <= start) {
      return {
        ok: false,
        code: "NON_POSITIVE_DISTANCE",
        error: "The end odometer must be greater than the start odometer.",
      };
    }
    if (hasDistance) {
      return {
        ok: false,
        code: "INCOMPLETE_ODOMETER",
        error: "Give either an odometer pair or a distance, not both.",
      };
    }
    const span = end - start;
    if (span > MAX_TRIP_DISTANCE) {
      return {
        ok: false,
        code: "DISTANCE_TOO_LARGE",
        error: `The readings are ${span.toLocaleString()} apart. Check them for a typo.`,
      };
    }
    return { ok: true, distance: round2(span) };
  }

  if (!hasDistance) {
    return {
      ok: false,
      code: "NO_DISTANCE",
      error: "Enter either a distance or an odometer pair.",
    };
  }

  const value = distance as number;
  if (!Number.isFinite(value)) {
    return { ok: false, code: "NO_DISTANCE", error: "Distance must be a number." };
  }
  if (value <= 0) {
    return {
      ok: false,
      code: "NON_POSITIVE_DISTANCE",
      error: "Distance must be greater than zero.",
    };
  }
  if (value > MAX_TRIP_DISTANCE) {
    return {
      ok: false,
      code: "DISTANCE_TOO_LARGE",
      error: `Distance cannot exceed ${MAX_TRIP_DISTANCE.toLocaleString()}.`,
    };
  }
  // More precision than this is measurement noise, and carrying it into money
  // arithmetic is how 0.1 + 0.2 problems reach a tax document.
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-9) {
    return {
      ok: false,
      code: "TOO_PRECISE",
      error: "Distance can have at most two decimals.",
    };
  }
  return { ok: true, distance: round2(value) };
}

/** A stored trip, as far as the arithmetic below is concerned. */
export interface TripForMath {
  date: Date;
  purpose: string;
  distance: number | null;
  distanceUnit: string;
  deductionRateCents: number | null;
  deductionCurrency: string | null;
}

/**
 * Deduction for one trip, in minor units, or null when there is nothing to
 * claim. Whole-unit distance times whole-unit rate is already an integer, so
 * no rounding rule is needed and none is applied.
 */
export function deductionCentsForTrip(trip: TripForMath): number | null {
  if (trip.distance === null || trip.deductionRateCents === null) return null;
  if (trip.distance <= 0 || trip.deductionRateCents < 0) return null;
  return Math.round(trip.distance * trip.deductionRateCents);
}

export interface PurposeSummary {
  purpose: string;
  tripCount: number;
  /** Never converted between units — see the module comment. */
  distance: Record<string, number>;
}

export interface DeductionSummary {
  currency: string;
  unit: string;
  rateCentsPerUnit: number;
  tripCount: number;
  amountCents: number;
}

export interface YearSummary {
  year: number;
  tripCount: number;
  distance: Record<string, number>;
  byPurpose: PurposeSummary[];
  /** One entry per distinct (currency, unit, rate) seen, so mixed history
   *  is reported as mixed instead of being averaged into a single lie. */
  deductions: DeductionSummary[];
  /** Trips logged while no rate was configured: distance counted, nothing claimed. */
  unratedTripCount: number;
}

/**
 * Group trips into per-calendar-year summaries.
 *
 * The year comes from the trip's own `date` in UTC. A trip dated 31 December
 * belongs to that year regardless of the viewer's timezone, which is what a
 * tax-year summary needs; the UI renders dates the same way.
 */
export function summarizeTripsByYear(trips: TripForMath[]): Map<number, YearSummary> {
  const years = new Map<number, YearSummary>();

  const ensure = (year: number): YearSummary => {
    let s = years.get(year);
    if (!s) {
      s = {
        year,
        tripCount: 0,
        distance: {},
        byPurpose: [],
        deductions: [],
        unratedTripCount: 0,
      };
      years.set(year, s);
    }
    return s;
  };

  const purposeIndex = new Map<string, PurposeSummary>();

  for (const trip of trips) {
    const year = trip.date.getUTCFullYear();
    const summary = ensure(year);
    summary.tripCount += 1;

    if (trip.distance !== null && trip.distance > 0) {
      summary.distance[trip.distanceUnit] = (summary.distance[trip.distanceUnit] ?? 0) + trip.distance;
    }

    // Keyed by year AND purpose: a year holds one bucket per purpose, and two
    // purposes in the same year must not collapse into each other.
    const purposeKey = `${year}:${trip.purpose}`;
    let purpose = purposeIndex.get(purposeKey);
    if (!purpose) {
      purpose = { purpose: trip.purpose, tripCount: 0, distance: {} };
      purposeIndex.set(purposeKey, purpose);
      summary.byPurpose.push(purpose);
    }
    purpose.tripCount += 1;
    if (trip.distance !== null && trip.distance > 0) {
      purpose.distance[trip.distanceUnit] =
        (purpose.distance[trip.distanceUnit] ?? 0) + trip.distance;
    }

    const cents = deductionCentsForTrip(trip);
    if (cents === null || trip.deductionCurrency === null) {
      summary.unratedTripCount += 1;
      continue;
    }
    const rate = trip.deductionRateCents as number;
    const unit = trip.distanceUnit;
    let entry = summary.deductions.find(
      (d) => d.currency === trip.deductionCurrency && d.unit === unit && d.rateCentsPerUnit === rate
    );
    if (!entry) {
      entry = { currency: trip.deductionCurrency, unit, rateCentsPerUnit: rate, tripCount: 0, amountCents: 0 };
      summary.deductions.push(entry);
    }
    entry.tripCount += 1;
    entry.amountCents += cents;
  }

  // Deterministic ordering: newest year first, and stable within a year so the
  // UI and the tests agree.
  for (const s of years.values()) {
    s.byPurpose.sort((a, b) => a.purpose.localeCompare(b.purpose));
    s.deductions.sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        a.unit.localeCompare(b.unit) ||
        a.rateCentsPerUnit - b.rateCentsPerUnit
    );
  }

  return new Map([...years.entries()].sort((a, b) => b[0] - a[0]));
}

/** Distinct years present, newest first — for the year selector. */
export function tripYears(trips: TripForMath[]): number[] {
  return [...new Set(trips.map((t) => t.date.getUTCFullYear()))].sort((a, b) => b - a);
}

/** A trip as stored, i.e. a Prisma row. */
export interface StoredTrip extends TripForMath {
  id: string;
  vehicleId: string;
  note: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  createdAt: Date;
}

/**
 * CSV columns and rows for the export, in the same shape the existing
 * `/api/export` sections use. The caller supplies the vehicle label so this
 * module stays free of database knowledge.
 */
export function tripCsvSection(
  trips: StoredTrip[],
  vehicleLabel: (tripId: string) => string
): { columns: string[]; rows: unknown[][] } {
  const columns = [
    "id", "date", "year", "vehicle", "purpose", "distance", "distanceUnit",
    "startOdometer", "endOdometer", "deductionRateCentsPerUnit", "deductionCurrency",
    "deductionAmountCents", "note", "createdAt",
  ];
  const rows = trips.map((t) => [
    t.id,
    t.date.toISOString(),
    t.date.getUTCFullYear(),
    vehicleLabel(t.vehicleId),
    t.purpose,
    t.distance,
    t.distanceUnit,
    t.startOdometer,
    t.endOdometer,
    t.deductionRateCents,
    t.deductionCurrency,
    deductionCentsForTrip(t),
    t.note,
    t.createdAt.toISOString(),
  ]);
  return { columns, rows };
}