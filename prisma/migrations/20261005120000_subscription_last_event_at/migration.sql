-- Out-of-order webhook protection (additive, nullable).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "lastEventAt" TIMESTAMP(3);
