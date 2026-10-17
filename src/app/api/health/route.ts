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
 *  - Reports only boolean/derived state. NO secrets, keys, hostnames, bucket
 *    names, endpoint URLs or connection strings are ever returned.
 *
 * Access model:
 *  - Anonymous (no/incorrect credentials): the body is exactly `{ "ok": true }`
 *    or `{ "ok": false }`. Nothing else — this endpoint is public and is
 *    scanned by bots.
 *  - Authorized (`Authorization: Bearer $HEALTH_SECRET`): the full detailed
 *    report, including the per-dependency checks and (with `?verbose=1`) the
 *    production configuration warnings.
 *  - The shared secret is compared in constant time and is never echoed. When
 *    `HEALTH_SECRET` is unset the detailed view is disabled for everyone.
 *
 * Performance:
 *  - Every probe is bounded by `PROBE_TIMEOUT_MS` and the four database round
 *    trips run concurrently, so a single slow query cannot hold the whole
 *    request open (previously ~3.6s and growing with each added query).
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import {
  emailConfigured,
  env,
  healthSecret,
  paddleConfigured,
  paddleEnvironment,
  paddleWebhookConfigured,
  prodWarnings,
} from "@/lib/env";
import { auditLog } from "@/lib/audit";
import { externalAnalyticsConfigured } from "@/lib/analytics";
import { storageDriver, s3MissingConfig } from "@/lib/storage";
import { cronConfigured } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Ceiling for a single dependency probe. */
const PROBE_TIMEOUT_MS = 2_000;

type Check = { ok: boolean; detail?: string };

/** Reject a probe that outlives its budget instead of waiting on it forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Constant-time comparison of the supplied bearer token with the configured
 * secret. Both sides are SHA-256 hashed first so the comparison does not
 * depend on the supplied length (timingSafeEqual requires equal-length
 * buffers), and an unset secret can never match.
 */
function secretMatches(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isAuthorized(req: Request): boolean {
  const expected = healthSecret();
  if (expected.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return secretMatches(header.slice(prefix.length), expected);
}

async function probeDatabase(): Promise<boolean> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * The migration ledger answers "is a migration in flight?".
 *
 * Rolled-back rows are deliberately ADVISORY, not a failure: a deployment that
 * was retried accumulates rolled-back rows alongside a later successful row
 * for the same migration, so treating them as failures yields a check that can
 * never go green even though the schema is correct. If a migration genuinely
 * did not take effect, the `schema` check is what catches it.
 */
async function probeMigrations(): Promise<{ check: Check }> {
  try {
    const [inFlight, rolledBack] = await Promise.all([
      withTimeout(
        db.$queryRaw<Array<{ migration_name: string }>>`
          SELECT DISTINCT migration_name
          FROM "_prisma_migrations"
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
          LIMIT 20
        `,
        PROBE_TIMEOUT_MS
      ),
      withTimeout(
        db.$queryRaw<Array<{ migration_name: string }>>`
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
        `,
        PROBE_TIMEOUT_MS
      ),
    ]);
    const detail =
      inFlight.length > 0
        ? `migration in flight: ${inFlight.map((r) => r.migration_name).join(", ")}`
        : rolledBack.length === 0
          ? "no pending migrations"
          : `${rolledBack.length} rolled-back migration(s) ignored (advisory only)`;
    return { check: { ok: inFlight.length === 0, detail } };
  } catch {
    // No raw error text: Prisma errors can embed the connection string/host.
    return { check: { ok: false, detail: "migration ledger unavailable" } };
  }
}

/**
 * Schema drift: does the database actually match the code?
 *
 * The Prisma migration ledger is NOT sufficient. A migration can be
 * `rolled_back` — neither `finished` nor `pending` — leaving the ledger clean
 * while the column the code queries does not exist. So the schema itself is
 * interrogated; these columns are the ones whose absence breaks a
 * customer-facing page.
 */
async function probeSchema(): Promise<{ check: Check; broken: boolean }> {
  const REQUIRED_COLUMNS: Array<{ table: string; column: string; usedBy: string }> = [
    { table: "Plan", column: "isDemo", usedBy: "/pricing, /settings/billing" },
  ];
  try {
    const rows = await withTimeout(
      db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN (${Prisma.join(REQUIRED_COLUMNS.map((c) => c.table))})
      `,
      PROBE_TIMEOUT_MS
    );
    const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = REQUIRED_COLUMNS.filter(
      (c) => !present.has(`${c.table}.${c.column}`)
    ).map((c) => `${c.table}.${c.column} (breaks ${c.usedBy})`);

    if (missing.length === 0) {
      return { check: { ok: true, detail: `${REQUIRED_COLUMNS.length} critical column(s) present` }, broken: false };
    }
    return {
      check: { ok: false, detail: `MISSING: ${missing.join(", ")} — run the pending migration` },
      broken: true,
    };
  } catch {
    // Non-Postgres (e.g. local SQLite) has no information_schema. The migration
    // ledger still runs checks; do not fail the probe because introspection is
    // unavailable. No raw error text (it can embed connection details).
    return { check: { ok: true, detail: "schema introspection unavailable — ledger check only" }, broken: false };
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const authorized = isAuthorized(req);

  const dbStartedAt = Date.now();
  const [dbOk, migrations, schema] = await Promise.all([
    probeDatabase(),
    probeMigrations(),
    probeSchema(),
  ]);
  const dbMs = Date.now() - dbStartedAt;

  const healthy = dbOk && !schema.broken;

  // --- Anonymous: a single boolean. Nothing else is disclosed. ----------
  if (!authorized) {
    return NextResponse.json(
      { ok: healthy },
      { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } }
    );
  }

  // --- Authorized: the full readiness report. ---------------------------
  const checks: Record<string, Check> = {};

  checks.database = { ok: dbOk, detail: dbOk ? `${dbMs}ms` : "unreachable" };
  if (!dbOk) {
    await auditLog({ action: "health.database_unreachable" }).catch(() => {});
  }

  const mailReady = emailConfigured();
  checks.email = {
    ok: mailReady,
    // Deliberately no host/port here: infrastructure hostnames are
    // reconnaissance for anyone scanning this endpoint.
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

  checks.paddle = {
    ok: paddleConfigured(),
    detail: paddleConfigured()
      ? `configured (${paddleEnvironment()}, seller set, ${paddleWebhookConfigured() ? "webhook secret set" : "WEBHOOK SECRET MISSING"})`
      : "server-side Paddle credentials incomplete — checkout will be reported as unavailable",
  };
  checks.paddleClientToken = {
    ok: Boolean(env.paddleClientToken),
    detail: env.paddleClientToken
      ? "present"
      : "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN missing — Paddle.js cannot open a checkout",
  };
  // Stripe is gone as of 2.2 and is no longer reported here.

  // Without the shared secret every /api/cron/* route fails closed (503), so
  // expiry, trial reminders and purges silently stop running.
  checks.cron = {
    ok: cronConfigured(),
    detail: cronConfigured()
      ? "CRON_SECRET set — scheduled jobs can run"
      : "CRON_SECRET unset or shorter than 16 chars — every /api/cron/* route returns 503",
  };

  // Error monitoring is optional. Local-only is the expected default, so it is
  // never a failure — the detail is what makes a missing DSN visible.
  checks.errorMonitoring = {
    ok: true,
    detail: env.sentryDsn
      ? "sentry DSN set — errors also forwarded off-site (scrubbed)"
      : "local only — errors go to the platform log and the AuditLog table (set SENTRY_DSN to also forward)",
  };

  checks.migrations = migrations.check;

  // Object storage: degraded, not fatal. The bucket name and endpoint host are
  // deliberately omitted even from this authorized report.
  const driver = storageDriver();
  if (driver === "s3") {
    const missing = s3MissingConfig();
    checks.storage = {
      ok: missing.length === 0,
      detail: missing.length === 0
        ? "s3 driver configured (bucket + endpoint withheld)"
        : `s3 driver selected but missing ${missing.join(", ")}`,
    };
  } else {
    checks.storage = {
      ok: Boolean(process.env.STORAGE_DIR),
      detail: process.env.STORAGE_DIR
        ? "local driver with STORAGE_DIR set — verify it points at a persistent volume, not ephemeral /tmp"
        : "local driver, STORAGE_DIR unset — uploads are LOST on redeploy",
    };
  }

  checks.analytics = {
    ok: true,
    detail: externalAnalyticsConfigured()
      ? "forwarding enabled (events also stored internally)"
      : "internal only — no third-party forwarding configured (expected default)",
  };

  checks.schema = schema.check;

  const degraded = Object.entries(checks)
    .filter(([, c]) => !c.ok)
    .map(([name]) => name);

  const verbose = new URL(req.url).searchParams.get("verbose") === "1";
  const body = {
    ok: healthy,
    status: healthy ? (degraded.length === 0 ? "ok" : "degraded") : "unhealthy",
    timestamp: new Date().toISOString(),
    checks,
    degraded,
    ...(verbose ? { warnings: prodWarnings() } : {}),
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
