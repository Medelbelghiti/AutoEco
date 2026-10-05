import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";

const UpdateSchema = z.object({
  brand: z.string().min(1).max(60).optional(),
  model: z.string().min(1).max(60).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  trim: z.string().nullable().optional(),
  fuelType: z.string().optional(),
  transmission: z.string().nullable().optional(),
  drivetrain: z.string().nullable().optional(),
  fuelEconomyText: z.string().nullable().optional(),
  purchaseDate: z.string().nullable().optional(),
  purchasePriceCents: z.number().int().nullable().optional(),
  estimatedResaleCents: z.number().int().nullable().optional(),
  currentMileage: z.number().int().nullable().optional(),
  currentMileageUnit: z.string().optional(),
  nickname: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const GET = withErrorHandling(async (_req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const { id } = ctx.params;
  const v = await db.vehicle.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(v.userId, user);
  return ok(v);
});

export const PATCH = withErrorHandling(async (req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const { id } = ctx.params;
  const v = await db.vehicle.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(v.userId, user);
  const body = await parseJson(req, UpdateSchema);
  const data: Record<string, unknown> = { ...body };
  if (body.purchaseDate !== undefined) data.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
  if (body.isPrimary) await db.vehicle.updateMany({ where: { userId: user.id, isPrimary: true, NOT: { id } }, data: { isPrimary: false } });
  const updated = await db.vehicle.update({ where: { id }, data });
  return ok(updated);
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const { id } = ctx.params;
  const v = await db.vehicle.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(v.userId, user);
  await db.expense.deleteMany({ where: { vehicleId: id } });
  await db.fuelEntry.deleteMany({ where: { vehicleId: id } });
  await db.trip.deleteMany({ where: { vehicleId: id } });
  await db.vehicle.delete({ where: { id } });
  return ok({ ok: true });
});
