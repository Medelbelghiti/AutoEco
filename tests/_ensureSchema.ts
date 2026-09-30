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
