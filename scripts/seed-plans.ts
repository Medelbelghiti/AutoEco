/**
 * Plans-only database remediation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The production `Plan` table was found to contain 140 `test_*` rows created
 * by the real-DB integration tests, all with `active = true`, and **zero** real
 * plans. The `20261001230000_add_plan_is_demo` migration defaults the new
 * column to `false`, so immediately after applying it every one of those test
 * rows would have become a "real" plan and `/pricing` would have served 140
 * zero-priced `Test ai-…@autoeco.app` entries to customers.
 *
 * `prisma/seed.ts` cannot fix this on its own in production: it deliberately
 * aborts unless `SEED_ADMIN_PASSWORD` is set (it must never mint an admin with
 * a default password), and running it with a non-production `NODE_ENV` would
 * create the demo user and sample vehicles/expenses in the live database.
 *
 * This script therefore does exactly two things, both non-destructive:
 *   1. marks every test fixture plan `isDemo = true` so pricing filters it out
 *      (the rows are KEPT, so a mistake is fully reversible);
 *   2. upserts the four real plans from `prisma/plans.data.ts` with
 *      `isDemo = false`.
 *
 * It creates no users and no sample data, so it is safe to run against a live
 * database. Re-running it is idempotent.
 *
 * Usage:  npx tsx scripts/seed-plans.ts
 */
import { PrismaClient } from "@prisma/client";
import { PLANS, planRow } from "../prisma/plans.data";

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  // 1. Quarantine test fixtures rather than deleting them. Deleting would be
  //    tidier, but if any subscription or user still references one of these
  //    keys the delete would fail — and more importantly a retained row is
  //    recoverable if the classification was ever wrong.
  const quarantined = await prisma.plan.updateMany({
    where: { isDemo: false, key: { startsWith: "test_" } },
    data: { isDemo: true, active: false },
  });
  console.log(`marked ${quarantined.count} test plan(s) as isDemo=true, active=false`);

  // 2. Upsert the real plans.
  for (const p of PLANS) {
    const row = planRow(p) as Record<string, unknown>;
    const key = row.key as string;
    const fields = { ...row };
    delete fields.key;
    await prisma.plan.upsert({
      where: { key },
      create: { ...row, isDemo: false } as never,
      update: { ...fields, isDemo: false } as never,
    });
    console.log(`  plan "${key}" ready`);
  }

  // 3. Report the final state so the outcome is verifiable from the logs.
  const visible = await prisma.plan.findMany({
    where: { active: true, isDemo: false },
    orderBy: { sortOrder: "asc" },
    select: { key: true, name: true, priceCents: true },
  });
  console.log(`\ncustomer-visible plans (active=true, isDemo=false): ${visible.length}`);
  for (const v of visible) {
    console.log(`  ${v.key.padEnd(10)} ${String(v.priceCents).padStart(5)}  ${v.name}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});