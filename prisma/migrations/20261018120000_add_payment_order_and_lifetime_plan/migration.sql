-- PayPal "Founder Lifetime" - additive only.
--
-- 1. "PaymentOrder": one row per PayPal order for the one-time lifetime
--    purchase. "providerOrderId" is UNIQUE and is the idempotency anchor that
--    both the capture endpoint and the webhook resolve grants through, so a
--    redelivered event or a double capture can never grant twice.
-- 2. A dedicated "lifetime" plan row carrying exactly the Pro limits and
--    monthly quotas. It is inserted idempotently (ON CONFLICT ("key") DO
--    NOTHING) and is deliberately kept out of "PLANS" in prisma/plans.data.ts;
--    /pricing and checkout hide it via UNAVAILABLE_PLAN_KEYS. Its non-zero
--    "priceCents" is required so getEntitlements() cannot honour a stale
--    User.planId pointer.
--
-- No existing row is updated or deleted; no column is altered or dropped.

CREATE TABLE IF NOT EXISTS "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "providerCaptureId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentOrder_providerOrderId_key" ON "PaymentOrder"("providerOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentOrder_providerCaptureId_key" ON "PaymentOrder"("providerCaptureId");
CREATE INDEX IF NOT EXISTS "PaymentOrder_userId_status_idx" ON "PaymentOrder"("userId", "status");
CREATE INDEX IF NOT EXISTS "PaymentOrder_status_idx" ON "PaymentOrder"("status");

ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Plan" (
    "id", "key", "name", "description", "priceCents", "currency", "billingPeriod",
    "maxVehicles", "maxExpensesPerMonth", "maxTripsPerMonth",
    "aiReceiptScansPerMonth", "aiConversationsPerMonth", "reportRetentionDays",
    "forecastHorizonMonths", "enableAdvancedScenarios", "enableShareableReports",
    "enablePdfReports", "enableFamilySharing", "enableApiAccess", "features",
    "sortOrder", "createdAt", "updatedAt"
) VALUES (
    'plan_lifetime_founder', 'lifetime', 'Founder Lifetime', 'One payment, lifetime access.',
    9900, 'USD', 'LIFETIME',
    5, 1000, 500,
    50, 100, 365,
    60, true, true,
    true, false, false, '["Up to 5 vehicles","Ask Your Car","Financial Twin","What-if scenarios"]',
    90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO NOTHING;
