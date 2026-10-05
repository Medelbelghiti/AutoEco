/**
 * Error capture.
 *
 * Two sinks, in order:
 *
 * 1. The platform log, always. If everything else fails this is what is left.
 * 2. The existing `AuditLog` table, so errors are queryable from the admin
 *    dashboard without any third party involved.
 * 3. Sentry, but only when `SENTRY_DSN` is set. Inert otherwise: no DSN means
 *    no network call, no import, no cost.
 *
 * Sentry is reached over its documented envelope endpoint with `fetch` rather
 * than by adding `@sentry/nextjs`. This module was written dependency-free on
 * purpose, the ask was for a thin adapter, and the envelope we need is one POST
 * of a small JSON document. The trade-off is that we do not get Sentry's
 * source-map upload or tracing; if the app later wants those, the vendor SDK
 * is a drop-in replacement for `reportToSentry()` alone.
 *
 * PII: events are scrubbed before they leave the process. See `scrub()`.
 */
import crypto from "crypto";
import { env } from "./env";

export interface ErrorContext {
  /** Where it happened, e.g. "POST /api/expenses". */
  scope?: string;
  userId?: string | null;
  /** Never put secrets, tokens or raw request bodies in here. */
  extra?: Record<string, unknown>;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: string;
}

function serialize(e: unknown): SerializedError {
  if (e instanceof Error) {
    const cause =
      e.cause instanceof Error
        ? `${(e.cause as Error).name}: ${(e.cause as Error).message}`
        : typeof e.cause === "string"
          ? e.cause
          : undefined;
    return {
      name: e.name,
      message: e.message,
      // Cap the stack so one pathological error cannot bloat the row.
      stack: e.stack?.slice(0, 4000),
      cause,
    };
  }
  return { name: "NonError", message: typeof e === "string" ? e.slice(0, 2000) : JSON.stringify(e)?.slice(0, 2000) ?? String(e) };
}

// ------------------------------ PII scrubbing ------------------------------

/** Keys whose values must never be sent off-site, matched case-insensitively. */
const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|auth|cookie|session|ssn|tax[-_]?id|card|cvv|iban)/i;

/** Deliberately coarse. A user id is an internal cuid, not PII, and it is the
 *  single most useful field for correlating a report with a support ticket. */
const ALLOWED_KEY = /^(user_?id|scope|name|message|stack|cause|env|environment|release|tags|count|duration_?ms|status|route|method|ip)$/i;

const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const MAX_STRING = 300;

/**
 * Reduce arbitrary context to a small allowlist of scalars.
 *
 * Allowlist rather than denylist: a denylist misses every field nobody thought
 * of, and this data is leaving the process. Anything not explicitly permitted
 * is dropped, and strings are truncated and email-scrubbed.
 */
export function scrub(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (ALLOWED_KEY.test(key)) out[key] = scrubString(value);
      continue;
    }
    // Objects and arrays are dropped: they are where request bodies and
    // records full of personal data would otherwise slip in.
  }
  return out;
}

function scrubString(value: string): string {
  return value.replace(EMAIL_LIKE, "[email]").slice(0, MAX_STRING);
}

// ------------------------------ Sentry sink --------------------------------

interface DsnParts {
  publicKey: string;
  host: string;
  projectId: string;
}

/**
 * Parse a Sentry DSN: `https://<key>@<host>/<projectId>`.
 *
 * Returns null for anything unparsable rather than throwing, because a
 * malformed DSN must not break error reporting.
 */
export function parseDsn(dsn: string): DsnParts | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const publicKey = url.username;
  const projectId = url.pathname.replace(/^\/+/, "");
  if (!publicKey || !projectId || !url.hostname) return null;
  return { publicKey, host: url.hostname, projectId };
}

function envelopeUrl(parts: DsnParts): string {
  // Explicit port: the SDK requires it in the URL even on the default.
  const port = parts.host.includes(":") ? parts.host : "";
  return `https://${parts.host}${port ? `:${port}` : ""}/api/${parts.projectId}/envelope/`;
}

/**
 * Send one event to Sentry. Fire and forget: never throws, never rejects, and
 * gives up quickly so a slow Sentry cannot hold up a response.
 */
async function reportToSentry(
  dsn: string,
  event: {
    message: string;
    ctx: ErrorContext;
    serialized: SerializedError | null;
  }
): Promise<void> {
  const parts = parseDsn(dsn);
  if (!parts) return;

  const header = {
    event_id: randomHex(16),
    sent_at: new Date().toISOString(),
    ...(env.sentryDsn ? { dsn } : {}),
    ...(env.sentryRelease ? { release: env.sentryRelease } : {}),
    ...(env.sentryEnvironment ? { environment: env.sentryEnvironment } : {}),
  };

  const payload = {
    timestamp: Math.floor(Date.now() / 1000),
    platform: "node",
    level: "error",
    logger: "autoeco.error-capture",
    ...(event.ctx.scope ? { transaction: event.ctx.scope } : {}),
    ...(event.ctx.userId ? { user: { id: event.ctx.userId } } : {}),
    ...(event.serialized
      ? {
          exception: {
            values: [
              {
                type: event.serialized.name,
                value: scrubString(event.serialized.message),
                ...(event.serialized.stack ? { stacktrace: { frames: parseFrames(event.serialized.stack) } } : {}),
                ...(event.serialized.cause ? { mechanism: { type: "chained", handled: false, data: { cause: scrubString(event.serialized.cause) } } } : {}),
              },
            ],
          },
        }
      : {}),
    ...(event.serialized ? { message: scrubString(event.serialized.message) } : {}),
    extra: scrub(event.ctx.extra),
    tags: event.ctx.scope ? { scope: event.ctx.scope } : {},
  };

  // Sentry envelope: an envelope header line, an item header line carrying the
  // byte length of the payload, then the payload itself.
  const payloadJson = JSON.stringify(payload);
  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
    length: Buffer.byteLength(payloadJson, "utf8"),
  });
  const envelope = `${JSON.stringify(header)}\n${itemHeader}\n${payloadJson}`;

  try {
    // 2s is generous for a fire-and-forget; Sentry ingest is normally <300ms.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    try {
      await fetch(envelopeUrl(parts), {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": `sentry sentry_version=7, sentry_client=autoeco/2.0, sentry_key=${parts.publicKey}`,
        },
        body: envelope,
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* swallow — reporting an error must not cause another error */
  }
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Best-effort conversion of a JS stack string into Sentry's frame shape. */
function parseFrames(stack: string): Array<{ filename: string; function?: string }> {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((line) => {
      const m = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
      return m
        ? { filename: `${m[2]}:${m[3]}`, function: m[1] }
        : { filename: line.trim() };
    });
}

/**
 * Report a non-exception event, e.g. a CSP violation report. Uses the same
 * sinks as `captureException`, which is what makes a week of Report-Only
 * observations actionable: the violation is queryable in the audit log and, if
 * a DSN is configured, visible in Sentry.
 */
export async function captureEvent(
  event: { message: string; level?: "warning" | "error" | "info" },
  ctx: ErrorContext = {}
): Promise<void> {
  const message = scrubString(event.message);
  const serialized: SerializedError = { name: "ApplicationEvent", message };
  // eslint-disable-next-line no-console
  console.warn(`[AutoEco] ${event.level ?? "info"}: ${message}`);
  await persist(serialized, ctx);
  if (env.sentryDsn) {
    void reportToSentry(env.sentryDsn, { message, ctx, serialized });
  }
}

// ------------------------------- persistence -------------------------------

/**
 * Persist the error. Never throws — reporting an error must not cause
 * another error. If the database is unreachable (the usual case when the DB
 * itself is what broke), this silently degrades to the console log.
 *
 * Writes through `db` directly rather than via `auditLog()`, because
 * `auditLog()` swallows its own errors: it would hide a failed insert and
 * leave us unable to retry. This sink has no throttle to honour anyway.
 */
async function persist(serialized: SerializedError, ctx: ErrorContext): Promise<void> {
  const metadata = {
    ...scrub(ctx.extra),
    scope: ctx.scope ?? null,
    name: serialized.name,
    message: serialized.message,
    stack: serialized.stack ?? null,
    cause: serialized.cause ?? null,
    env: env.isProd ? "production" : "development",
  };
  const ip = ctx.extra?.ip as string | undefined;

  const write = async (userId: string | null, extra: Record<string, unknown> = {}) => {
    const { db } = await import("./db");
    await db.auditLog.create({
      data: {
        userId,
        action: "error.unhandled",
        metadata: JSON.stringify({ ...metadata, ...extra }),
        ip,
      },
    });
  };

  try {
    await write(ctx.userId ?? null);
  } catch {
    // `AuditLog.userId` is a foreign key, so an error attributed to a user who
    // has just been deleted — or to an id that never existed — fails the
    // insert. Retry un-attributed before giving up: losing the record because
    // the attribution was stale is the one failure mode worth working around.
    if (!ctx.userId) return;
    try {
      await write(null, { userIdDropped: ctx.userId });
    } catch {
      /* swallow — see doc comment */
    }
  }
}

/**
 * Report an exception. Returns void so callers can `await` it without
 * changing their return values.
 */
export async function captureException(e: unknown, ctx: ErrorContext = {}): Promise<void> {
  const serialized = serialize(e);
  // Always log to the platform first: if the DB write fails we still have it.
  // eslint-disable-next-line no-console
  console.error(
    `[AutoEco] unhandled error${ctx.scope ? ` in ${ctx.scope}` : ""}: ${serialized.name}: ${serialized.message}`,
    serialized.stack ?? ""
  );
  await persist(serialized, ctx);

  if (env.sentryDsn) {
    void reportToSentry(env.sentryDsn, { message: serialized.message, ctx, serialized });
  }
}

let installed = false;

/**
 * Attach process-level handlers, called once from `instrumentation.ts` at boot.
 *
 * These do not exit the process: on serverless the platform can still return
 * a response for unrelated in-flight requests, and the error has already been
 * persisted and logged. Vercel surfaces it through the function log.
 */
export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (e) => {
    void captureException(e, { scope: "process.uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    void captureException(reason, { scope: "process.unhandledRejection" });
  });
}