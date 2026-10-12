-- PDF ownership-cost reports: a dedicated entitlement, separate from
-- enableShareableReports. Downloading a PDF and publishing a share link are
-- different products, and tying them together would make it impossible to grant
-- one without the other.
--
-- Additive and idempotent. The default is false so any row this migration does
-- not name keeps the conservative answer.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "enablePdfReports" BOOLEAN NOT NULL DEFAULT false;

-- The plan rows already in the database are NOT touched by prisma/seed.ts, so
-- seeding alone would leave every existing pro/family/pro_plus account on the
-- default of false: a paid feature that silently does not work for anyone who
-- subscribed before it shipped. Backfill by key.
--
-- free is deliberately absent: it stays false. Any test or demo row created
-- with a random key also stays false, which is the safe direction to be wrong
-- in.
UPDATE "Plan" SET "enablePdfReports" = true WHERE "key" IN ('pro', 'family', 'pro_plus');
