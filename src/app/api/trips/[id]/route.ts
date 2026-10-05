import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildPeriodKey, release } from "@/lib/quota";
import {
  TRIP_PURPOSES,
  TRIP_DISTANCE_UNITS,
  MAX_TRIP_DISTANCE,
  resolveDistance,
  deductionCentsForTrip,
  type TripDistanceUnit,
} from "@/lib/trips";

const MAX_ODOMETER = 100_000_000;

const UpdateSchema = z.object({
  date: z.string().min(1).optional(),
  purpose: z.enum(TRIP_PURPOSES).optional(),
  startOdometer: z.number().int().min(0).max(MAX_ODOMETER).nullable().optional(),
  endOdometer: z.number().int().min(0).max(MAX_ODOMETER).nullable().optional(),
  distance: z.number().positive().max(MAX_TRIP_DISTANCE).nullable().optional(),
  distanceUnit: z.enum(TRIP_DISTANCE_UNITS).optional(),
  note: z.string().max(2000).nullable().optional(),
  vehicleId: z.string().min(1).optional(),
});

export const GET = withErrorHandling(async (_req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const trip = await db.trip.findUnique({ where: { id: ctx.params.id } });
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(trip.userId, user);
  return ok({ ...trip, deductionAmountCents: deductionCentsForTrip(trip) });
});

export const PATCH = withErrorHandling(async (req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const trip = await db.trip.findUnique({ where: { id: ctx.params.id } });
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(trip.userId, user);

  const body = await parseJson(req, UpdateSchema);
  const data: Record<string, unknown> = {};

  if (body.date !== undefined) data.date = new Date(body.date);
  if (body.purpose !== undefined) data.purpose = body.purpose;
  if (body.note !== undefined) data.note = body.note;
  if (body.startOdometer !== undefined) data.startOdometer = body.startOdometer;
  if (body.endOdometer !== undefined) data.endOdometer = body.endOdometer;

  // Moving a trip to another vehicle needs that vehicle's ownership checked,
  // exactly like creating one.
  if (body.vehicleId !== undefined && body.vehicleId !== trip.vehicleId) {
    const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    assertOwnership(vehicle.userId, user);
    data.vehicleId = body.vehicleId;
  }

  const touchesDistance =
    body.startOdometer !== undefined ||
    body.endOdometer !== undefined ||
    body.distance !== undefined ||
    body.distanceUnit !== undefined;

  if (touchesDistance) {
    const distanceUnit = (body.distanceUnit ?? trip.distanceUnit) as TripDistanceUnit;

    // Validate against the merged row, not just the fields present in the
    // patch: clearing `distance` while leaving one odometer behind must fail
    // rather than silently wipe the trip's length.
    const resolved = resolveDistance({
      startOdometer: body.startOdometer !== undefined ? body.startOdometer : trip.startOdometer,
      endOdometer: body.endOdometer !== undefined ? body.endOdometer : trip.endOdometer,
      distance: body.distance !== undefined ? body.distance : trip.distance,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error, code: resolved.code }, { status: 422 });
    }
    data.distance = resolved.distance;
    data.distanceUnit = distanceUnit;

    // A trip that already carries a snapshotted rate was recorded in that
    // rate's unit (guaranteed at creation). Switching the unit now would leave
    // the stored rate describing a distance it was never meant for, so refuse
    // instead of silently restating the figure. The rate is deliberately not
    // refreshed from the user's current setting either: an edit must never
    // change a number the user may already have filed.
    if (trip.deductionRateCents !== null && distanceUnit !== trip.distanceUnit) {
      return NextResponse.json(
        {
          error:
            "This trip already has a deduction rate recorded in its current unit. Delete it and log it again in the new unit.",
          code: "DEDUCTION_UNIT_MISMATCH",
        },
        { status: 422 }
      );
    }
  }

  const updated = await db.trip.update({ where: { id: trip.id }, data });
  return ok({ ...updated, deductionAmountCents: deductionCentsForTrip(updated) });
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const trip = await db.trip.findUnique({ where: { id: ctx.params.id } });
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(trip.userId, user);

  // Deleting a trip frees a slot in the quota it was counted against. That
  // bucket is keyed by the trip's own month, not by today: deleting a trip
  // logged last month must not hand back a slot in the current month, which
  // would let a user push past this month's limit. Both candidate keys are
  // released because a `release` against a bucket that never existed is a
  // no-op, and the trip may have been logged either as a trial user or not.
  const periodKeys = [
    buildPeriodKey(trip.date),
    buildPeriodKey(trip.date, { trial: true, userId: user.id }),
  ];
  await db.trip.delete({ where: { id: trip.id } });
  for (const periodKey of periodKeys) {
    await release({ userId: user.id, metric: "trips", periodKey }).catch(() => {});
  }
  return ok({ ok: true });
});