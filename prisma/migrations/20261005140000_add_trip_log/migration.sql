/*
  Add the mileage / trip log (Phase 3.3).

  New table `Trip` plus three columns on `User` and one on `Plan`:

    - User.mileageDeductionRateCents / Currency / Unit hold the deduction rate
      the user supplied for their own jurisdiction. Intentionally nullable with
      no default: deduction rules differ per country and per year, and shipping
      a built-in figure would be a tax claim we cannot support. While they are
      null the log records distance only.
    - Plan.maxTripsPerMonth is the per-plan quota for logged trips. It defaults
      to 25 rather than 0 on purpose: a default of 0 would make the feature look
      broken to every existing account the moment this deploys, before anyone
      has run the plan repair. `scripts/seed-plans.ts` sets the real per-plan
      values from prisma/plans.data.ts.

  Additive only: one new table, three nullable columns, one column with a
  default. No existing row is rewritten and no existing query changes meaning.
  `IF NOT EXISTS` keeps the migration re-runnable against an environment where
  part of it was applied out of band.

  Trip.distanceUnit and the snapshot columns are deliberately unconstrained at
  the database level, matching how the rest of this schema treats enumerated
  strings (Vehicle.mileageUnit, Expense.category, ...): the allowed values are
  enforced by Zod at the API boundary, not by CHECK constraints.
*/
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxTripsPerMonth" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mileageDeductionCurrency" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mileageDeductionRateCents" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mileageDeductionUnit" TEXT;

CREATE TABLE IF NOT EXISTS "Trip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "startOdometer" INTEGER,
    "endOdometer" INTEGER,
    "distance" DOUBLE PRECISION,
    "distanceUnit" TEXT NOT NULL DEFAULT 'km',
    "note" TEXT,
    "deductionRateCents" INTEGER,
    "deductionCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Trip_userId_date_idx" ON "Trip"("userId", "date");
CREATE INDEX IF NOT EXISTS "Trip_vehicleId_date_idx" ON "Trip"("vehicleId", "date");
CREATE INDEX IF NOT EXISTS "Trip_userId_purpose_idx" ON "Trip"("userId", "purpose");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Trip_userId_fkey') THEN
    ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Trip_vehicleId_fkey') THEN
    ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;