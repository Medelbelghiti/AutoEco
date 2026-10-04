/**
 * Next.js instrumentation hook.
 *
 * Runs once per server instance on boot. This is the only reliable place to
 * run a fail-fast production configuration audit: `env.ts` is imported
 * lazily by many modules, so a module-level call could be skipped by code
 * paths that never touch it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProdOnBoot } = await import("@/lib/env");
  const { installProcessHandlers } = await import("@/lib/error-capture");

  assertProdOnBoot();
  installProcessHandlers();
}