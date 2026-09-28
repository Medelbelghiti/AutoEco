-- AlterTable
ALTER TABLE "User" ADD COLUMN "lemonCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_lemonCustomerId_key" ON "User"("lemonCustomerId");

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "lemonSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_lemonSubscriptionId_key" ON "Subscription"("lemonSubscriptionId");

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "lemonOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_lemonOrderId_key" ON "Invoice"("lemonOrderId");
