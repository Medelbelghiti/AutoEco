-- AlterTable
ALTER TABLE "User" ADD COLUMN "paddleCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_paddleCustomerId_key" ON "User"("paddleCustomerId");

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "paddleSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paddleSubscriptionId_key" ON "Subscription"("paddleSubscriptionId");

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "paddleOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paddleOrderId_key" ON "Invoice"("paddleOrderId");
