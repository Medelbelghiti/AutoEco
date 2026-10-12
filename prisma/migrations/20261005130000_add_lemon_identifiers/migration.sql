/*
  Add the provider-neutral Lemon Squeezy identifier columns
  (User.lemonCustomerId, Subscription.lemonSubscriptionId,
  Invoice.lemonOrderId).

  These three columns were declared in `schema.prisma` but no migration ever
  created them, so `prisma migrate deploy` produced a schema that disagreed
  with the Prisma Client: any query touching a Lemon field failed against a
  freshly migrated database (CI, staging, a new environment).

  Additive only, mirroring 20260928084411_add_paddle_identifiers: nullable
  TEXT + unique index, so existing rows stay valid. `IF NOT EXISTS` keeps the
  migration re-runnable against an environment where the columns were added
  out of band.
*/
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lemonCustomerId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_lemonCustomerId_key" ON "User"("lemonCustomerId");

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "lemonSubscriptionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_lemonSubscriptionId_key" ON "Subscription"("lemonSubscriptionId");

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "lemonOrderId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_lemonOrderId_key" ON "Invoice"("lemonOrderId");