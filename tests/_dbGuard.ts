/**
 * Real-DB test guard.
 *
 * The integration tests in this suite create and delete rows, and some of
 * them run idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements
 * against whatever `DATABASE_URL` points at.
 *
 * That is fine for a throwaway database and dangerous for anything else: in
 * this repository `.env` points at the PRODUCTION Neon database, so running
 * the suite unguarded writes test fixtures into live data.
 *
 * So: DB-backed tests only run when the target is unambiguously local, or
 * when the developer explicitly opts in for a specific remote database.
 */
import { PrismaClient } from "@prisma/client";
import { isLocalDatabaseUrl } from "@/lib/db-url";

export const DB_URL = process.env.DATABASE_URL ?? "";

/** Explicit opt-in: `ALLOW_TEST_DB_WRITES=1 npm test` */
const OPTED_IN = process.env.ALLOW_TEST_DB_WRITES === "1";

/**
 * True when it is safe to run write-capable integration tests.
 * Read-only/unit tests must not use this. Same rule as the Playwright demo
 * seed: local (file:/loopback) unless the developer explicitly opts in.
 */
export const DB_OK = DB_URL.length > 0 && (isLocalDatabaseUrl(DB_URL) || OPTED_IN);

if (DB_URL.length > 0 && !DB_OK) {
  // eslint-disable-next-line no-console
  console.warn(
    [
      "",
      "  SKIPPING real-DB integration tests.",
      `  DATABASE_URL points at a remote database (${isLocalDatabaseUrl(DB_URL) ? "unrecognised" : "non-local"}).`,
      "  These tests INSERT/UPDATE/DELETE rows and run ALTER TABLE statements.",
      "  If this database is production, running them will modify live data.",
      "",
      "  To run them against a remote test database, set:",
      "    ALLOW_TEST_DB_WRITES=1 npm test",
      "",
    ].join("\n")
  );
}

export function makePrisma(): PrismaClient {
  return new PrismaClient();
}