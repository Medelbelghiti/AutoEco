import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { TRIP_DISTANCE_UNITS } from "@/lib/trips";

/**
 * The mileage deduction rate is the user's own figure for their jurisdiction.
 * All three fields are set together and cleared together: a rate without a
 * currency or without a unit cannot be applied to anything, so allowing a
 * partial update would store a rate that silently claims nothing.
 */
const DeductionFields = {
  mileageDeductionRateCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  mileageDeductionCurrency: z.enum(SUPPORTED_CURRENCIES).nullable().optional(),
  mileageDeductionUnit: z.enum(TRIP_DISTANCE_UNITS).nullable().optional(),
} as const;

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  locale: z.enum(["en", "fr"]).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  distanceUnit: z.enum(["km", "mi"]).optional(),
  fuelUnit: z.enum(["L_PER_100KM", "MPG", "KM_PER_L"]).optional(),
  ...DeductionFields,
});

const DeductionShape = z.object(DeductionFields);

export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  return ok({
    id: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    currency: user.currency,
    distanceUnit: user.distanceUnit,
    fuelUnit: user.fuelUnit,
    mileageDeductionRateCents: user.mileageDeductionRateCents,
    mileageDeductionCurrency: user.mileageDeductionCurrency,
    mileageDeductionUnit: user.mileageDeductionUnit,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
  });
});

export const PATCH = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, UpdateSchema);

  const { name, locale, currency, distanceUnit, fuelUnit, ...deduction } = body;

  // Any deduction field present means the user is setting or clearing the whole
  // rate, so require all three (a rate of 0 is legitimate: some jurisdictions
  // allow nothing, and it makes the field explicit).
  const touchesDeduction = Object.keys(deduction).length > 0;
  if (touchesDeduction) {
    const { success } = DeductionShape.safeParse({
      mileageDeductionRateCents: deduction.mileageDeductionRateCents ?? null,
      mileageDeductionCurrency: deduction.mileageDeductionCurrency ?? null,
      mileageDeductionUnit: deduction.mileageDeductionUnit ?? null,
    });
    if (!success) {
      return NextResponse.json(
        {
          error:
            "Set the deduction rate, its currency and its unit together, or clear all three.",
          code: "INCOMPLETE_DEDUCTION_SETTINGS",
        },
        { status: 422 }
      );
    }
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { name, locale, currency, distanceUnit, fuelUnit, ...deduction },
  });
  return ok({
    id: updated.id,
    name: updated.name,
    locale: updated.locale,
    currency: updated.currency,
    distanceUnit: updated.distanceUnit,
    fuelUnit: updated.fuelUnit,
    mileageDeductionRateCents: updated.mileageDeductionRateCents,
    mileageDeductionCurrency: updated.mileageDeductionCurrency,
    mileageDeductionUnit: updated.mileageDeductionUnit,
  });
});
