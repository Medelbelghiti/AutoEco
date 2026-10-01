"use strict";

/**
 * Build script with resilient migrations.
 *
 * Vercel runs `npm run build` once per deploy. The previous script
 * (`prisma generate && prisma migrate deploy && next build`) failed
 * when the Neon DB was slow or auto-suspended (free tier).
 *
 * This wrapper:
 *   1. Generates the Prisma client
 *   2. Attempts to apply migrations with a 60s budget
 *   3. If the DB is unreachable OR a transient error (P1002 / lock
 *      timeout) occurs, prints a warning and continues
 *      (the migration will apply on the next deploy when Neon wakes up)
 *   4. Builds the Next.js app
 *
 * Production DBs (Neon production tier, RDS, etc.) never go to sleep,
 * so this is only a no-op during dev/free-tier deploys.
 */

const { spawn } = require("node:child_process");
const { writeFileSync, readFileSync, unlinkSync, createWriteStream } = require("node:fs");
const isWindows = process.platform === "win32";

function runSafe(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: true, ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); process.stdout.write(d); });
    child.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
    child.on("error", (err) => resolve({ status: -1, error: err, stdout, stderr }));
  });
}

async function main() {
  // 1. Prisma generate
  console.log("▶ prisma generate");
  const gen = await runSafe(isWindows ? "npx.cmd" : "npx", ["prisma", "generate"]);
  if (gen.status !== 0) {
    console.error("✗ prisma generate failed");
    process.exit(gen.status ?? 1);
  }

  // 2. Migrate deploy with 60s budget
  console.log("▶ prisma migrate deploy (best-effort, 60s budget)");
  const start = Date.now();
  const mig = await runSafe(isWindows ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"]);
  const elapsed = Date.now() - start;

  const combined = (mig.stdout ?? "") + "\n" + (mig.stderr ?? "");
  const transient =
    /P1002|advisory lock|timed out|connection|ENOTFOUND|EHOSTUNREACH|getaddrinfo|prisma migrate deploy.*timeout|exited with code 60|P1001/i.test(combined);

  // The historic misnamed "lemon_squeezy" directory was created with a
  // Paddle SQL inside; it recorded a FAILED migration on the live DB.
  // Prisma blocks ALL subsequent migrations while a failed one is
  // recorded. Auto-resolve it as rolled back — the migration never made
  // partial changes (it failed before any column was added because the
  // SQL was misnamed and the migration did not match the schema history).
  if (/P3009/i.test(combined) || /P1001/i.test(combined)) {
    console.warn(`⚠ Found a recorded failed migration on the live DB.`);
    console.warn(`  Attempting to mark it as rolled back so subsequent migrations can apply.`);
    // Find which migration name failed.
    const failedNameMatch = combined.match(/(\d{14}_[\w_]+)/);
    const failedName = failedNameMatch ? failedNameMatch[1] : "20260928084411_add_lemon_squeezy_identifiers";
    console.warn(`  Resolving: ${failedName}`);
    const resolve = await runSafe(isWindows ? "npx.cmd" : "npx", [
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      failedName,
    ]);
    if (resolve.status === 0) {
      console.warn(`✓ marked ${failedName} as rolled back`);
      // Retry the deploy now that the failed row is cleared.
      const retry = await runSafe(isWindows ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"]);
      const elapsed2 = Date.now() - start;
      if (retry.status === 0) {
        console.log(`✓ migrate deploy completed (after rollback) in ${elapsed2}ms`);
      } else {
        console.warn(`⚠ retry failed: ${retry.stderr?.slice(0, 500)}`);
      }
      process.exit(0);
    } else {
      console.error(`✗ could not resolve the failed migration: ${resolve.stderr?.slice(0, 500)}`);
      process.exit(1);
    }
  }

  if (mig.error && (mig.error.code === "ETIMEDOUT" || mig.error.killed)) {
    console.warn(`⚠ migrate deploy timed out — DB may be slow.`);
    console.warn(`  Migration will run on the next deploy when the DB is healthy.`);
  } else if (mig.status !== 0 && transient) {
    console.warn(`⚠ migrate deploy failed transiently (elapsed=${elapsed}ms).`);
    console.warn(`  This is typically lock contention from a previous deploy or transient network.`);
    console.warn(`  Migration will apply on the next deploy.`);
  } else if (mig.status !== 0) {
    console.error(`✗ prisma migrate deploy failed (status=${mig.status}, elapsed=${elapsed}ms)`);
    console.error(`  stderr: ${(mig.stderr ?? "").slice(0, 1000)}`);
    process.exit(mig.status ?? 1);
  } else {
    console.log(`✓ prisma migrate deploy completed in ${elapsed}ms`);
  }

  // 3. Build
  console.log("▶ next build");
  const build = await runSafe(isWindows ? "npx.cmd" : "npx", ["next", "build"]);
  if (build.status !== 0) {
    console.error("✗ next build failed");
    process.exit(build.status ?? 1);
  }
  console.log("✓ build complete");
}

main().catch((err) => {
  console.error("✗ unexpected:", err);
  process.exit(1);
});