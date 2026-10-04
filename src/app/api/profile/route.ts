import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  locale: z.enum(["en", "fr"]).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  distanceUnit: z.enum(["km", "mi"]).optional(),
  fuelUnit: z.enum(["L_PER_100KM", "MPG", "KM_PER_L"]).optional(),
});

export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  return ok({ id: user.id, email: user.email, name: user.name, locale: user.locale, currency: user.currency, distanceUnit: user.distanceUnit, fuelUnit: user.fuelUnit, role: user.role, emailVerifiedAt: user.emailVerifiedAt });
});

export const PATCH = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, UpdateSchema);
  const updated = await db.user.update({ where: { id: user.id }, data: body });
  return ok({ id: updated.id, name: updated.name, locale: updated.locale, currency: updated.currency, distanceUnit: updated.distanceUnit, fuelUnit: updated.fuelUnit });
});
