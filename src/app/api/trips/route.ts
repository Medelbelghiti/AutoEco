import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { buildPeriodKey, tryConsume, release } from "@/lib/quota";
import {
  TRIP_PURPOSES,
  TRIP_DISTANCE_UNITS,
  MAX_TRIP_DISTANCE,
  resolveDistance,
  deductionCentsForTrip,
  type TripDistanceUnit,
} from "@/lib/trips";

/** A car that has been driven 100 million miles is a typo, not a vehicle. */
const MAX_ODOMETER = 100_000_000;

const TripSchema = z.object({
  vehicleId: z.string().min(1),
  date: z.string().min(1),
  purpose: z.enum(TRIP_PURPOSES),
  // Either an odometer pair or a direct distance; resolveDistance decides.
  startOdometer: z.number().int().min(0).max(MAX_ODOMETER).nullable().optional(),
  endOdometer: z.number().int().min(0).max(MAX_ODOMETER).nullable().optional(),
  distance: z.number().positive().max(MAX_TRIP_DISTANCE).nullable().optional(),
  distanceUnit: z.enum(TRIP_DISTANCE_UNITS).optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const GET = withErrorHandling(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const vehicleId = url.searchParams.get("vehicleId");
  const yearParam = url.searchParams.get("year");

  const where: Record<string, unknown> = { userId: user.id };
  if (vehicleId) where.vehicleId = vehicleId;
  if (yearParam) {
    const year = Number(yearParam);
    // An unparsable year must not silently widen the result set to everything.
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }
    where.date = {
      gte: new Date(Date.UTC(year, 0, 1)),
      lt: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  const trips = await db.trip.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: { vehicle: { select: { id: true, nickname: true, brand: true, model: true, year: true } } },
  });

  return ok({
    trips: trips.map((t) => ({
      ...t,
      distanceUnit: t.distanceUnit as TripDistanceUnit,
      deductionAmountCents: deductionCentsForTrip(t),
    })),
  });
});

/**
 * Per-year summaries live on their own route (`/api/trips/summary`) rather than
 * behind a query parameter here, so the yearly aggregation cost is never paid
 * by a plain trip list.
 */
export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, TripSchema);

  // 1. Vehicle ownership.
  const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId } });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  assertOwnership(vehicle.userId, user);

  // 2. Distance.
  const resolved = resolveDistance(body);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: 422 });
  }

  const distanceUnit = body.distanceUnit ?? (user.distanceUnit as TripDistanceUnit);

  // 3. A deduction figure is only ever the user's own rate, snapshotted here.
  //    If they have set one in a different unit we refuse rather than apply a
  //    rate to a distance it was not meant for.
  const hasRate = user.mileageDeductionRateCents !== null;
  if (hasRate && user.mileageDeductionUnit && user.mileageDeductionUnit !== distanceUnit) {
    return NextResponse.json(
      {
        error: `Your deduction rate is set per ${user.mileageDeductionUnit}, but this trip is in ${distanceUnit}. Change the rate's unit in Settings, or log the trip in ${user.mileageDeductionUnit}.`,
        code: "DEDUCTION_UNIT_MISMATCH",
      },
      { status: 422 }
    );
  }

  // 4. Authoritative entitlement + atomic quota reservation.
  const ent = await getEntitlements(user);
  const periodKey = buildPeriodKey(new Date(), { trial: ent.isTrial, userId: user.id });
  const reservation = await tryConsume({
    userId: user.id,
    metric: "trips",
    periodKey,
    limit: ent.maxTripsPerMonth,
  });
  if (!reservation.allowed) {
    return NextResponse.json(
      {
        error: ent.maxTripsPerMonth === 0
          ? "Trip logging is not included in your plan"
          : `Monthly trip limit reached (${ent.maxTripsPerMonth})`,
        code: "TRIP_QUOTA_EXCEEDED",
      },
      { status: 403 }
    );
  }

  // 5. Create. If this fails, hand the reservation back.
  let created;
  try {
    created = await db.trip.create({
      data: {
        userId: user.id,
        vehicleId: body.vehicleId,
        date: new Date(body.date),
        purpose: body.purpose,
        startOdometer: body.startOdometer ?? null,
        endOdometer: body.endOdometer ?? null,
        distance: resolved.distance,
        distanceUnit,
        note: body.note ?? null,
        deductionRateCents: hasRate ? user.mileageDeductionRateCents : null,
        deductionCurrency: hasRate ? user.mileageDeductionCurrency : null,
      },
    });
  } catch (e) {
    await release({ userId: user.id, metric: "trips", periodKey }).catch(() => {});
    throw e;
  }

  return ok({ ...created, deductionAmountCents: deductionCentsForTrip(created) }, 201);
});