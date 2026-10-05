/**
 * Test-only schema bootstrapper.
 *
 * The real-DB concurrency + webhook tests assume the production schema,
 * including the additive `lemon*` columns (for the unused idempotency
 * tests of `WebhookEvent` / `WebhookSideEffect`). If the migration has
 * not been applied to the test DB, we add the columns idempotently here
 * so the tests are self-contained and do not require a separate
 * "apply migrations" step.
 *
 * This is a NO-OP when the columns already exist (Postgres
 * `ADD COLUMN IF NOT EXISTS` is idempotent at the DB level).
 *
 * It is INTENTIONALLY test-only. It is safe (only adds nullable
 * columns with unique indexes) and reversible.
 */
import { PrismaClient } from "@prisma/client";

export async function ensureLemonSqueezySchema(prisma: PrismaClient): Promise<void> {
  const stmts = [
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lemonCustomerId" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_lemonCustomerId_key" ON "User"("lemonCustomerId")`,
    `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "lemonSubscriptionId" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_lemonSubscriptionId_key" ON "Subscription"("lemonSubscriptionId")`,
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "lemonOrderId" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_lemonOrderId_key" ON "Invoice"("lemonOrderId")`,
  ];
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch {
      // ignored — column or index may already exist or DB may not support
      // IF NOT EXISTS. Tests will fail later if the schema is genuinely
      // incompatible.
    }
  }
}

/**
 * Same idea for the Paddle additive columns. Production migration runs
 * via `prisma migrate deploy`; this helper keeps the real-DB concurrency
 * tests self-contained when the migration has not yet been applied.
 */
export async function ensurePaddleSchema(prisma: PrismaClient): Promise<void> {
  const stmts = [
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paddleCustomerId" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_paddleCustomerId_key" ON "User"("paddleCustomerId")`,
    `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_paddleSubscriptionId_key" ON "Subscription"("paddleSubscriptionId")`,
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paddleOrderId" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_paddleOrderId_key" ON "Invoice"("paddleOrderId")`,
  ];
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch {
      // ignored
    }
  }
}

/**
 * Same idea for the trip log: the `Trip` table plus the user's deduction
 * preferences and the plan quota column. Additive and idempotent, so the trip
 * tests do not depend on `prisma migrate deploy` having been run first.
 */
export async function ensureTripSchema(prisma: PrismaClient): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS "Trip" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "vehicleId" TEXT NOT NULL,
      "date" TIMESTAMP(3) NOT NULL,
      "purpose" TEXT NOT NULL,
      "startOdometer" INTEGER,
      "endOdometer" INTEGER,
      "distance" DOUBLE PRECISION,
      "distanceUnit" TEXT NOT NULL DEFAULT 'km',
      "deductionRateCents" INTEGER,
      "deductionCurrency" TEXT,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "Trip_userId_date_idx" ON "Trip"("userId", "date")`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mileageDeductionRateCents" INTEGER`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mileageDeductionCurrency" TEXT`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mileageDeductionUnit" TEXT`,
    `ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxTripsPerMonth" INTEGER NOT NULL DEFAULT 25`,
  ];
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch {
      // ignored
    }
  }
}
