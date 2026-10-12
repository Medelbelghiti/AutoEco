#!/usr/bin/env node
/**
 * Local `prisma migrate` wrapper.
 *
 * `prisma migrate` uses the datasource `directUrl` (DIRECT_URL) when it is set,
 * so it can bypass a connection pooler (Neon/PgBouncer). There is no pooler in
 * local development, so when DIRECT_URL is unset we default it to DATABASE_URL
 * and let the normal Prisma CLI handle the rest. Production sets DIRECT_URL to
 * the non-pooled endpoint explicitly.
 *
 * The same `.env` the Prisma CLI reads is loaded first, so the fallback sees the
 * exact DATABASE_URL the CLI will use.
 *
 * Usage: node scripts/prisma-migrate.mjs <dev|deploy> [args...]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // A malformed .env should not block the CLI's own error reporting.
  }
}

const env = { ...process.env };
if (!env.DIRECT_URL && env.DATABASE_URL) env.DIRECT_URL = env.DATABASE_URL;

const isWindows = process.platform === "win32";
const result = spawnSync(isWindows ? "npx.cmd" : "npx", ["prisma", "migrate", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env,
});

process.exit(result.status ?? 1);
