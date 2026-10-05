/**
 * Trip-log database queries.
 *
 * Kept out of `lib/trips.ts` (which is deliberately free of database access so
 * the arithmetic can be tested in isolation) and out of the route files (which
 * may only export route handlers).
 */
import { db } from "./db";
import { summarizeTripsByYear, tripYears, type YearSummary } from "./trips";

export interface TripSummaryResponse {
  years: number[];
  summaries: YearSummary[];
  /**
   * True when the user has not configured a deduction rate. The UI shows a
   * neutral prompt in that case instead of implying a figure is missing.
   */
  hasDeductionRate: boolean;
}

/**
 * Per-year summaries of a user's whole trip log.
 *
 * Capped at 5000 rows: a real mileage log reaches that over several years, and
 * the cap bounds both the query and the aggregation. If a user ever exceeds it
 * the oldest year is simply absent from `years`, which the UI can surface.
 */
export async function getTripSummaries(userId: string): Promise<TripSummaryResponse> {
  const trips = await db.trip.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    take: 5000,
  });
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mileageDeductionRateCents: true },
  });
  return {
    years: tripYears(trips),
    summaries: [...summarizeTripsByYear(trips).values()],
    hasDeductionRate: user?.mileageDeductionRateCents !== null && user?.mileageDeductionRateCents !== undefined,
  };
}