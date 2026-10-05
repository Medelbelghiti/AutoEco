/**
 * GET /api/health
 *
 * Liveness + configuration readiness probe for uptime monitoring and alerting.
 *
 * Design decisions:
 *  - Returns 503 when the database is unreachable, or when the schema does
 *    not match the code (missing column). Both are genuine outages: in the
 *    second case real pages are serving HTTP 500 right now, and a monitor that
 *    saw 200 would stay green through a broken storefront.
 *  - Returns 200 while a merely *degraded* dependency is missing (email
 *    transport, Paddle credentials, persistent storage). Those are reported
 *    in the body so they are visible without paging anyone.
 *  - Reports only boolean/derived state. NO secrets, keys, hostnames or
 *    connection strings are ever returned.
 *  - `?verbose=1` adds the production configuration warnings (readable
 *    message text, still no secret values).
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  emailConfigured,
  env,
  paddleConfigured,
  paddleEnvironment,
  paddleWebhookConfigured,
  prodWarnings,
} from "@/lib/env";
import { auditLog } from "@/lib/audit";
import { externalAnalyticsConfigured } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const verbose = url.searchParams.get("verbose") === "1";

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // --- Database: the only hard dependency. -----------------------------
  const startedAt = Date.now();
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
    checks.database = { ok: true, detail: `${Date.now() - startedAt}ms` };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" };
    await auditLog({ action: "health.database_unreachable" }).catch(() => {});
  }

  // --- Email: degraded, not fatal. -------------------------------------
  const mailReady = emailConfigured();
  checks.email = {
    ok: mailReady,
    // Deliberately no host/port here: this endpoint is unauthenticated, and
    // infrastructure hostnames are reconnaissance for anyone scanning it.
    detail: mailReady
      ? "provider=smtp configured"
      : `provider="${env.emailProvider}" is not a real transport — email is being written to the server log only`,
  };
  if (!mailReady) {
    // Recorded at most once per hour: uptime probes hit this endpoint every
    // few seconds and would otherwise flood the audit table.
    await auditLog({
      action: "health.email_not_configured",
      metadata: { provider: env.emailProvider },
      throttleKey: "health.email_not_configured",
    }).catch(() => {});
  }

  // --- Payments. --------------------------------------------------------
  checks.paddle = {
    ok: paddleConfigured(),
    detail: paddleConfigured()
      ? `configured (${paddleEnvironment()}, seller set, ${paddleWebhookConfigured() ? "webhook secret set" : "WEBHOOK SECRET MISSING"})`
      : "server-side Paddle credentials incomplete — checkout will be reported as unavailable",
  };
  checks.paddleClientToken = {
    ok: Boolean(env.paddleClientToken),
    detail: env.paddleClientToken ? "present" : "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN missing — Paddle.js cannot open a checkout",
  };
  // Stripe is gone as of 2.2 and is no longer reported here.

  // --- Migrations: the ledger answers "is a migration in flight?", while the
  // --- information_schema check above answers "does the code match the DB?".
  // --- Only the former is a failure here.
  //
  // Rolled-back rows are deliberately ADVISORY, not a failure. A deployment
  // that was retried accumulates rolled-back rows alongside a later successful
  // row for the same migration; treating those as failures produces a health
  // check that can never go green even though the schema is correct. If a
  // migration genuinely did not take effect, the `schema` check above is what
  // catches it — by looking for the actual missing column.
  try {
    const inFlight = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT DISTINCT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
      LIMIT 20
    `;
    const rolledBack = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT DISTINCT migration_name
      FROM "_prisma_migrations"
      WHERE rolled_back_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "_prisma_migrations" f
          WHERE f.migration_name = "_prisma_migrations".migration_name
            AND f.finished_at IS NOT NULL
            AND f.rolled_back_at IS NULL
        )
      LIMIT 20
    `;

    const detail =
      inFlight.length > 0
        ? `${inFlight.length} migration(s) failed or never finished: ${inFlight
            .map((p) => p.migration_name)
            .join(", ")}`
        : rolledBack.length > 0
          ? `no failed migrations (advisory: ${rolledBack.length} rolled-back attempt(s) never re-applied, ignored because the schema check above is authoritative)`
          : "no failed migrations";

    checks.migrations = { ok: inFlight.length === 0, detail };
  } catch (e) {
    // `_prisma_migrations` is unavailable (e.g. a shadow database).
    checks.migrations = { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" };
  }

  checks.storage = {
    ok: Boolean(process.env.STORAGE_DIR),
    // A local-disk STORAGE_DIR is EPHEMERAL on serverless hosts: uploaded
    // receipts vanish on redeploy. That is a data-loss risk, not a crash, so
    // it is reported but never fatal.
    detail: process.env.STORAGE_DIR
      ? "STORAGE_DIR set — verify it points at a persistent volume, not ephemeral /tmp"
      : "STORAGE_DIR unset — uploads fall back to local disk and are LOST on redeploy",
  };

  checks.analytics = {
    ok: true,
    detail: externalAnalyticsConfigured()
      ? "forwarding enabled (events also stored internally)"
      : "internal only — no third-party forwarding configured (expected default)",
  };

  // --- Schema drift: does the database actually match the code? ---------
  //
  // The Prisma migration ledger is NOT sufficient. A migration can be
  // `rolled_back` — which is neither `finished` nor `pending` — leaving the
  // ledger clean while the column the code queries does not exist. That is the
  // exact current state of this deployment, and the ledger-only check reported
  // "no pending migrations" while /pricing returned HTTP 500.
  //
  // So the schema itself is interrogated. These columns are the ones whose
  // absence breaks a customer-facing page, so they are worth a per-request
  // information_schema lookup.
  const REQUIRED_COLUMNS: Array<{ table: string; column: string; usedBy: string }> = [
    { table: "Plan", column: "isDemo", usedBy: "/pricing, /settings/billing" },
  ];
  try {
    const rows = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (${Prisma.join(REQUIRED_COLUMNS.map((c) => c.table))})
    `;
    const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = REQUIRED_COLUMNS.filter(
      (c) => !present.has(`${c.table}.${c.column}`)
    ).map((c) => `${c.table}.${c.column} (breaks ${c.usedBy})`);

    checks.schema = {
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${REQUIRED_COLUMNS.length} critical column(s) present`
          : `MISSING: ${missing.join(", ")} — run \`prisma migrate deploy\``,
    };
  } catch (e) {
    // Non-Postgres (SQLite local dev) has no information_schema.
    checks.schema = {
      ok: true,
      detail: `schema introspection unavailable on this engine (${
        e instanceof Error ? e.message.slice(0, 80) : "unknown"
      }) — ledger check only`,
    };
  }

  const failing = Object.entries(checks)
    .filter(([, v]) => !v.ok)
    .map(([k]) => k);

  /**
   * Schema drift is FATAL, unlike the other checks.
   *
   * A missing column means real pages are serving HTTP 500 right now (this is
   * the live state of the current deployment: /pricing is broken). Reporting
   * that as a healthy 200 would let an uptime monitor stay green through a
   * broken storefront, which is precisely the failure mode a health endpoint
   * exists to prevent.
   */
  const schemaBroken = checks.schema?.ok === false;

  const body = {
    status: !dbOk || schemaBroken ? "unhealthy" : failing.length === 0 ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    degraded: failing,
    ...(verbose ? { warnings: prodWarnings() } : {}),
  };

  return NextResponse.json(body, {
    status: dbOk && !schemaBroken ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}