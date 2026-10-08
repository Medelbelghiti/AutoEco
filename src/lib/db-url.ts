/**
 * Shared "is this database local?" guard — the single source of truth for
 * every tool that writes to DATABASE_URL: the DB-backed vitest suite, the
 * Playwright demo seed, anything that must never write to a remote/production
 * database by accident.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  if (url.startsWith("file:")) return true;
  return /@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
}