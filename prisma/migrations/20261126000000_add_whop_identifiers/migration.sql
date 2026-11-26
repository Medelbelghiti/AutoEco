/*
  Whop replaces Paddle and PayPal as the payment provider.

  Additive only: every new column is nullable, so existing rows (and the
  retired Paddle and PayPal columns and tables) are left untouched.
*/
ALTER TABLE "User" ADD COLUMN "whopUserId" TEXT;
CREATE UNIQUE INDEX "User_whopUserId_key" ON "User"("whopUserId");

ALTER TABLE "Subscription" ADD COLUMN "whopMembershipId" TEXT;
CREATE UNIQUE INDEX "Subscription_whopMembershipId_key" ON "Subscription"("whopMembershipId");

ALTER TABLE "Invoice" ADD COLUMN "whopPaymentId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "whopMembershipId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "whopPaidAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Invoice_whopPaymentId_key" ON "Invoice"("whopPaymentId");
CREATE INDEX "Invoice_whopMembershipId_whopPaidAt_idx" ON "Invoice"("whopMembershipId", "whopPaidAt");
