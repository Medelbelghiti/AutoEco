/**
 * Observability (Task 8): the `/api/health` readiness probe and the config
 * warnings it surfaces.
 *
 * Mirrors reality: 200 while only optional dependencies are missing, per-
 * dependency detail present so a human (or the admin dashboard) can see *why*
 * it is degraded, and no secret value ever in the body.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

type Health = {
  status: string;
  checks: Record<string, { ok: boolean; detail?: string }>;
  degraded: string[];
  warnings?: string[];
};

const CRON = "health_test_cron_secret_16chars";

describe("prodWarnings", () => {
  it("flags an unset CRON_SECRET in production", async () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const savedCron = process.env.CRON_SECRET;
    const savedNode = process.env.NODE_ENV;
    delete process.env.CRON_SECRET;
    mutableEnv.NODE_ENV = "production";
    vi.resetModules();
    try {
      const fresh = await import("@/lib/env");
      expect(fresh.prodWarnings().some((w) => /CRON_SECRET/.test(w))).toBe(true);
    } finally {
      mutableEnv.NODE_ENV = savedNode;
      if (savedCron !== undefined) process.env.CRON_SECRET = savedCron;
      vi.resetModules();
    }
  });
});

runSuite("observability: /api/health (real DB)", () => {
  let health: typeof import("@/app/api/health/route");
  const OLD_CRON = process.env.CRON_SECRET;

  beforeAll(async () => {
    process.env.CRON_SECRET = CRON;
    health = await import("@/app/api/health/route");
  });

  afterAll(async () => {
    if (OLD_CRON === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = OLD_CRON;
    await prisma.$disconnect();
  });

  const get = (qs = "") => health.GET(new Request(`https://autoeco.test/api/health${qs}`));
  const bodyOf = async (qs = "") => (await (await get(qs)).json()) as Health;

  run("returns 200 while only optional dependencies are missing", async () => {
    const res = await get();
    const body = (await res.json()) as Health;
    expect(res.status).toBe(200);
    expect(["ok", "degraded"]).toContain(body.status);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.checks.database.ok).toBe(true);
  });

  run("reports cron and error-monitoring readiness", async () => {
    const body = await bodyOf();
    expect(body.checks.cron).toBeTruthy();
    expect(body.checks.cron.ok).toBe(true);
    expect(body.checks.errorMonitoring).toBeTruthy();
    // Local-only monitoring is the expected default and is never a failure.
    expect(body.checks.errorMonitoring.ok).toBe(true);
  });

  run("GET is usable by a monitor and verbose adds warnings", async () => {
    const body = await bodyOf("?verbose=1");
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  run("never returns a secret value, even in verbose mode", async () => {
    const res = await get("?verbose=1");
    const text = await res.text();
    expect(text).not.toContain(CRON);
    if (process.env.AUTH_SECRET) expect(text).not.toContain(process.env.AUTH_SECRET);
    if (process.env.PADDLE_WEBHOOK_SECRET) {
      expect(text).not.toContain(process.env.PADDLE_WEBHOOK_SECRET);
    }
  });
});
