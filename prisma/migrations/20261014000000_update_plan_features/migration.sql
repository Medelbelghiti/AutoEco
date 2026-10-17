-- The marketing bullets on /pricing are stored per plan in "Plan"."features".
--
-- "prisma/plans.data.ts" (applied by "scripts/seed-plans.ts" and "prisma/seed.ts")
-- owns that JSON, but the rows already in production were written from an older
-- revision of the list and a re-seed does not touch a row it did not change. The
-- result was that /pricing kept advertising features that are NOT built:
-- "AI receipt scan", "API access" and "Family sharing" are all flagged
-- COMING_SOON_FEATURES in "src/lib/plans.ts" ("receiptScanning", "apiAccess",
-- "familySharing"), and the family plan itself is hidden via
-- UNAVAILABLE_PLAN_KEYS.
--
-- This migration brings the existing rows back in line with plans.data.ts.
--   * data-only: it changes "features" and nothing else — every limit and
--     feature-flag column is left exactly as it is;
--   * idempotent: each row is set to a fixed JSON value, so applying it twice
--     (or to a database already seeded from plans.data.ts) converges on the
--     same result;
--   * bounded: it names the four real plans and leaves every other row (test
--     fixtures, demo rows) untouched.
--
-- Values are JSON.stringify(PLANS[].features) exactly, so they match what
-- scripts/seed-plans.ts would write, and tests/plans-features.test.ts asserts
-- that these strings and plans.data.ts can never drift apart again.
UPDATE "Plan" SET "features" = '["1 vehicle","Expense tracking"]' WHERE "key" = 'free';
UPDATE "Plan" SET "features" = '["Up to 5 vehicles","Ask Your Car","Financial Twin","What-if scenarios"]' WHERE "key" = 'pro';
UPDATE "Plan" SET "features" = '["Up to 12 vehicles"]' WHERE "key" = 'family';
UPDATE "Plan" SET "features" = '["Up to 50 vehicles","Ask Your Car","Financial Twin"]' WHERE "key" = 'pro_plus';
