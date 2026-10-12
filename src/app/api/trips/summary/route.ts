import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getTripSummaries } from "@/lib/trips-queries";

/**
 * GET /api/trips/summary
 *
 * Per-calendar-year totals for the caller's own trips: distance per unit, a
 * breakdown by purpose, and deduction arithmetic grouped by currency, unit and
 * rate. Nothing here is aggregated across currencies or converted between
 * distance units, because both would require a claim we cannot source.
 */
export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  return ok(await getTripSummaries(user.id));
});