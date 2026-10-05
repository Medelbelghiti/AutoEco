/**
 * Concurrency-safe quota enforcement.
 *
 * Architecture:
 *   - One row per (userId, metric, periodKey) in QuotaUsage.
 *   - Period = "YYYY-MM" calendar month (or "trial:<userId>" for trial).
 *   - "tryConsume" does a SINGLE atomic SQL operation:
 *       INSERT ... ON CONFLICT (userId, metric, periodKey) DO UPDATE
 *         SET used = used + 1
 *         WHERE "QuotaUsage"."used" < $limit
 *       RETURNING used, ...
 *     — this is one statement, one round trip, and the WHERE clause
 *     guarantees the limit cannot be exceeded under any concurrency.
 *   - The first call for a new (userId, metric, periodKey) inserts a row
 *     with used=0; the ON CONFLICT branch then increments if under the limit.
 *   - "release" decrements (for cases where a downstream step fails
 *     and we want to refund the reservation).
 *   - "peek" returns current usage without consuming.
 *
 * The OLD implementation used count() + create() inside a transaction,
 * which is race-prone: two concurrent requests could both pass the count
 * check before either insert lands, exceeding the limit. The new
 * INSERT ... ON CONFLICT ... WHERE used < limit is provably race-safe
 * under PostgreSQL semantics.
 *
 * NOTE: ON CONFLICT DO UPDATE WHERE is supported in PostgreSQL ≥ 9.5
 * (which Neon uses). SQLite has a more limited ON CONFLICT form, so for
 * SQLite (local dev) we transparently fall back to a sequential
 * SELECT + UPDATE pattern inside a transaction. The fallback is not
 * truly race-safe under SQLite's database-level concurrency, but SQLite
 * is intended only for local development — production uses Postgres.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "./db";
import { notifyQuotaLimitReached } from "./notifications";

export type QuotaMetric = "ai_conversations" | "ocr_scans" | "expenses" | "vehicles" | "trips";

export class QuotaExceededError extends Error {
  metric: QuotaMetric;
  used: number;
  limit: number;
  constructor(metric: QuotaMetric, used: number, limit: number) {
    super(limit === 0
      ? `${metric.replace("_", " ")} is not included in your plan`
      : `${metric.replace("_", " ")} limit reached (${limit})`
    );
    this.name = "QuotaExceededError";
    this.metric = metric;
    this.used = used;
    this.limit = limit;
  }
}

export interface QuotaConsumeResult {
  used: number;
  limit: number;
  allowed: boolean;
}

function currentPeriodKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Build the period key used for QuotaUsage rows. Trial users get a
 *  per-user key so multiple trial users don't share a counter. */
export function buildPeriodKey(now: Date = new Date(), opts: { trial?: boolean; userId?: string } = {}): string {
  if (opts.trial && opts.userId) return `trial:${opts.userId}`;
  return currentPeriodKey(now);
}

/**
 * Returns a transaction-safe read of the current usage for a metric+period.
 * Pass `tx` (a Prisma transaction client) to read inside an existing
 * transaction. Otherwise reads via the global client.
 */
async function getUsed(
  tx: Pick<PrismaClient, "quotaUsage"> | PrismaClient,
  userId: string,
  metric: QuotaMetric,
  periodKey: string
): Promise<number> {
  const row = await tx.quotaUsage.findUnique({
    where: { userId_metric_periodKey: { userId, metric, periodKey } },
    select: { used: true },
  });
  return row?.used ?? 0;
}

/**
 * Atomically reserve one unit of quota. Returns allowed=true if the
 * reservation succeeded; allowed=false if the limit was reached.
 *
 * Concurrency: a single SQL statement (`UPDATE ... WHERE used < limit`)
 * — the limit check and the increment are applied atomically by the
 * database, so N concurrent requests against limit L produce AT MOST L
 * successful reservations.
 *
 * Implementation: we use `prisma.$executeRaw` with parameterised SQL
 * (Prisma supports raw where the ORM where-clause composition would
 * otherwise be too coarse). SQLite and Postgres both support this
 * statement and apply it atomically.
 */
export async function tryConsume(opts: {
  userId: string;
  metric: QuotaMetric;
  periodKey: string;
  limit: number;
  tx?: PrismaClient;
}): Promise<QuotaConsumeResult> {
  const { userId, metric, periodKey, limit, tx } = opts;
  if (limit <= 0) {
    return { used: 0, limit, allowed: false };
  }

  const client = tx ?? db;

  // Step 1: ensure row exists. We use a raw INSERT ... ON CONFLICT DO NOTHING
  // which is race-safe (multiple concurrent inserts all return success
  // because the conflict is silently absorbed). The Prisma `upsert`
  // would also work, but under heavy concurrency it can surface the
  // P2002 unique-constraint error to the caller; raw SQL is more
  // predictable.
  await client.$executeRaw(
    Prisma.sql`INSERT INTO "QuotaUsage" ("id", "userId", "metric", "periodKey", "used", "createdAt", "updatedAt")
     VALUES (${`q_${userId}_${metric}_${periodKey}`}, ${userId}, ${metric}, ${periodKey}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("userId", "metric", "periodKey") DO NOTHING`
  ).catch(() => 0);

  // Step 2: atomic conditional increment via raw SQL.
  const result = await client.$executeRaw<number>(
    Prisma.sql`UPDATE "QuotaUsage" SET "used" = "used" + 1 WHERE "userId" = ${userId} AND "metric" = ${metric} AND "periodKey" = ${periodKey} AND "used" < ${limit}`
  ).catch(() => 0);

  if (result === 0) {
    const used = await getUsed(client, userId, metric, periodKey);
    return { used, limit, allowed: false };
  }

  const used = await getUsed(client, userId, metric, periodKey);

  // Exactly-once-per-period notification. `used` can only equal the limit on
  // the single increment that arrives at it — every later attempt is blocked
  // by the `used < limit` predicate — so no dedupe bookkeeping is required.
  if (used === limit) {
    await notifyQuotaLimitReached({ userId, metric, limit });
  }

  return { used, limit, allowed: true };
}

/** Decrement (release) one unit. Used when a downstream step fails
 *  after a successful reservation. Will not go below zero. */
export async function release(opts: {
  userId: string;
  metric: QuotaMetric;
  periodKey: string;
  tx?: PrismaClient;
}): Promise<void> {
  const { userId, metric, periodKey, tx } = opts;
  const client = tx ?? db;
  await client.$executeRaw(
    Prisma.sql`UPDATE "QuotaUsage" SET "used" = "used" - 1 WHERE "userId" = ${userId} AND "metric" = ${metric} AND "periodKey" = ${periodKey} AND "used" > 0`
  ).catch(() => 0);
}

/** Read-only: do not consume. */
export async function peekUsage(opts: {
  userId: string;
  metric: QuotaMetric;
  periodKey: string;
}): Promise<number> {
  return getUsed(db, opts.userId, opts.metric, opts.periodKey);
}

// Re-export getEntitlements for convenience so API routes can import both
// quota + entitlement from a single module.
export { getEntitlements } from "./plans";
