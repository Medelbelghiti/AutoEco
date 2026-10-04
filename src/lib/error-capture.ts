/**
 * Minimal error capture — deliberately dependency-free.
 *
 * This app has no external error tracker wired up, which means a production
 * exception is invisible until a user complains. Rather than add a vendor SDK
 * (new dependency, new config surface, another thing to forget in CI) we
 * persist unhandled errors to the existing `AuditLog` table so they are
 * queryable from the admin dashboard, and always mirror them to the
 * platform log.
 *
 * If you later adopt Sentry or similar, replace `persist()` with the vendor
 * SDK — `captureException()` is the single seam to swap.
 */
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

/**
 * Persist the error. Never throws — reporting an error must not cause
 * another error. If the database is unreachable (the usual case when the DB
 * itself is what broke), this silently degrades to the console log.
 */
async function persist(serialized: SerializedError, ctx: ErrorContext): Promise<void> {
  try {
    const { auditLog } = await import("./audit");
    await auditLog({
      userId: ctx.userId ?? null,
      action: "error.unhandled",
      ip: ctx.extra?.ip as string | undefined,
      metadata: {
        ...ctx.extra,
        scope: ctx.scope ?? null,
        name: serialized.name,
        message: serialized.message,
        stack: serialized.stack ?? null,
        cause: serialized.cause ?? null,
        env: env.isProd ? "production" : "development",
      },
    });
  } catch {
    /* swallow — see doc comment */
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
}

let installed = false;

/**
 * Attach process-level handlers. Called from `instrumentation.ts` at boot.
 * `uncaughtException` and `unhandledRejection` do not crash the process here
 * on purpose: on serverless the platform can still return a response for
 * unrelated in-flight requests, and the error is already persisted. Vercel
 * will surface it via the log.
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