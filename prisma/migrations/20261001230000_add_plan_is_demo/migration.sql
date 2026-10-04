ALTER TABLE "Plan" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Defense in depth: nothing marked isDemo should ever be active=true.
-- We do NOT add a constraint here because production data on the live
-- Neon DB does not yet have the isDemo column and we want the migration
-- to be safe for both an empty DB (no rows) and an existing DB
-- (existing rows default to false).
-- Application code filters by `isDemo = false` in every user-facing
-- query path; the seed marks test rows explicitly.
