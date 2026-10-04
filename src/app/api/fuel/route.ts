import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeFuelConsumption } from "@/lib/compute-cost";
import { isSupportedCurrency, SUPPORTED_CURRENCIES } from "@/lib/currency";

const FuelSchema = z.object({
  vehicleId: z.string().min(1),
  date: z.string().min(1),
  mileage: z.number().int().min(0),
  mileageUnit: z.string().optional(),
  liters: z.number().min(0).max(10000).nullable().optional(),
  kwh: z.number().min(0).max(10000).nullable().optional(),
  amountCents: z.number().int().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES),
  pricePerUnit: z.number().min(0).nullable().optional(),
  fullTank: z.boolean().optional(),
  station: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const GET = withErrorHandling(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const vehicleId = url.searchParams.get("vehicleId");
  const where = { userId: user.id, ...(vehicleId ? { vehicleId } : {}) };
  const entries = await db.fuelEntry.findMany({ where, orderBy: { date: "desc" }, take: 200 });
  return ok({ entries });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, FuelSchema);

  if (!isSupportedCurrency(body.currency)) {
    return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });
  }
  if (body.mileageUnit && !["km", "mi"].includes(body.mileageUnit)) {
    return NextResponse.json({ error: "Unsupported mileage unit" }, { status: 400 });
  }

  const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId } });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  assertOwnership(vehicle.userId, user);

  const date = new Date(body.date);

  let consumption: number | null = null;
  if (body.liters && body.fullTank) {
    // CRITICAL: prior entry must satisfy date < current date.
    // If the user backfills a historical entry, we must NOT pick a newer
    // entry as the "previous" reference (it would produce negative distance).
    const prior = await db.fuelEntry.findFirst({
      where: {
        vehicleId: body.vehicleId,
        fullTank: true,
        date: { lt: date },
        // mileage must be <= current to avoid impossible negative distance
        mileage: { lte: body.mileage },
      },
      orderBy: { date: "desc" },
    });
    if (prior && prior.liters) {
      const distance = body.mileage - prior.mileage;
      if (distance >= 0) consumption = computeFuelConsumption(body.liters, distance);
    }
  }

  const created = await db.fuelEntry.create({
    data: {
      userId: user.id, vehicleId: body.vehicleId, date,
      mileage: body.mileage, mileageUnit: body.mileageUnit ?? user.distanceUnit,
      liters: body.liters ?? null, kwh: body.kwh ?? null,
      amountCents: body.amountCents, currency: body.currency,
      pricePerUnit: body.pricePerUnit ?? null,
      fullTank: body.fullTank ?? true, station: body.station ?? null, notes: body.notes ?? null,
      consumption,
    },
  });
  return ok(created);
});
