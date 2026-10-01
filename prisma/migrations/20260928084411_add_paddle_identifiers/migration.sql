/*
  Add Paddle identifier columns (User.paddleCustomerId,
  Subscription.paddleSubscriptionId, Invoice.paddleOrderId). All
  columns are nullable + unique so existing rows remain compatible.
*/
ALTER TABLE "User" ADD COLUMN "paddleCustomerId" TEXT;
CREATE UNIQUE INDEX "User_paddleCustomerId_key" ON "User"("paddleCustomerId");

ALTER TABLE "Subscription" ADD COLUMN "paddleSubscriptionId" TEXT;
CREATE UNIQUE INDEX "Subscription_paddleSubscriptionId_key" ON "Subscription"("paddleSubscriptionId");

ALTER TABLE "Invoice" ADD COLUMN "paddleOrderId" TEXT;
CREATE UNIQUE INDEX "Invoice_paddleOrderId_key" ON "Invoice"("paddleOrderId");