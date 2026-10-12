/*
  Paddle refund handling (adjustment.created / adjustment.updated).

  Paddle Billing delivers refunds as adjustment events, not
  `transaction.refunded`. Handling a full refund of the latest payment of a
  subscription needs to (a) link a paid transaction to its subscription and
  (b) order payments deterministically. Both are additive additions:

    - Invoice.paddleSubscriptionId: links a payment to its subscription.
    - Invoice.refundedAmountCents: cumulative refunded amount (minor units).
    - Invoice.paddleBilledAt: Paddle's transaction timestamp (ordering).
    - RefundAdjustment: one row per applied refund adjustment; UNIQUE on the
      Paddle adjustment id makes application idempotent across the
      adjustment.created + adjustment.updated pair and across retries.

  Additive only: nullable columns, a defaulted counter, one new table. Existing
  rows stay valid. `IF NOT EXISTS` keeps the migration re-runnable.
*/
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "refundedAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paddleBilledAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Invoice_paddleSubscriptionId_paddleBilledAt_idx" ON "Invoice"("paddleSubscriptionId", "paddleBilledAt");

CREATE TABLE IF NOT EXISTS "RefundAdjustment" (
  "id" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RefundAdjustment_adjustmentId_key" ON "RefundAdjustment"("adjustmentId");
CREATE INDEX IF NOT EXISTS "RefundAdjustment_transactionId_idx" ON "RefundAdjustment"("transactionId");
