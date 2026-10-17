import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();

const HEALTH_SECRET_VALUE = "health-secret-0123456789abcdef0123456789";
const S3_ENDPOINT_VALUE = "https://r2-endpoint-should-not-leak.example.test";
const S3_BUCKET_VALUE = "bucket-should-not-leak";
const S3_ACCESS_KEY_VALUE = "fake-access-key-id-should-not-leak";
const S3_SECRET_KEY_VALUE = "fake-secret-access-key-should-not-leak";
const CRON = "health_test_cron_secret_16chars";

type Health = {
  ok: boolean;
  status?: string;
  checks?: Record<string, { ok: boolean; detail?: string }>;
  degraded?: string[];
  warnings?: string[];
};

const SECRET_BITS = [
  HEALTH_SECRET_VALUE,
  S3_ENDPOINT_VALUE,
  S3_BUCKET_VALUE,
  S3_ACCESS_KEY_VALUE,
  S3_SECRET_KEY_VALUE,
];

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

const runSuite = DB_OK ? describe : describe.skip;

runSuite("observability: /api/health (real DB)", () => {
  let health: typeof import("@/app/api/health/route");
  // Imported inside beforeAll so it is the SAME module instance the route
  // resolved (the prodWarnings suite above calls vi.resetModules()).
  let dbClient: typeof import("@/lib/db").db;
  const SAVED = {
    cron: process.env.CRON_SECRET,
    health: process.env.HEALTH_SECRET,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    s3AccessKey: process.env.S3_ACCESS_KEY_ID,
    s3SecretKey: process.env.S3_SECRET_ACCESS_KEY,
    storageDriver: process.env.STORAGE_DRIVER,
  };

  beforeAll(async () => {
    // Storage values are captured by `env` at import time; set them first so
    // the storage check is exercised in its "configured" branch.
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = S3_ENDPOINT_VALUE;
    process.env.S3_BUCKET = S3_BUCKET_VALUE;
    process.env.S3_ACCESS_KEY_ID = S3_ACCESS_KEY_VALUE;
    process.env.S3_SECRET_ACCESS_KEY = S3_SECRET_KEY_VALUE;
    process.env.CRON_SECRET = CRON;
    process.env.HEALTH_SECRET = HEALTH_SECRET_VALUE;
    health = await import("@/app/api/health/route");
    dbClient = (await import("@/lib/db")).db;
  });

  afterAll(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("CRON_SECRET", SAVED.cron);
    restore("HEALTH_SECRET", SAVED.health);
    restore("S3_ENDPOINT", SAVED.s3Endpoint);
    restore("S3_BUCKET", SAVED.s3Bucket);
    restore("S3_ACCESS_KEY_ID", SAVED.s3AccessKey);
    restore("S3_SECRET_ACCESS_KEY", SAVED.s3SecretKey);
    restore("STORAGE_DRIVER", SAVED.storageDriver);
    await prisma.$disconnect();
  });

  const anonGet = (qs = "") => health.GET(new Request(`https://autoeco.test/api/health${qs}`));
  const authGet = (qs = "") =>
    health.GET(
      new Request(`https://autoeco.test/api/health${qs}`, {
        headers: { authorization: `Bearer ${HEALTH_SECRET_VALUE}` },
      })
    );

  it("anonymous request returns 200 and ONLY { ok } while healthy", async () => {
    const res = await anonGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Health;
    expect(body).toEqual({ ok: true });
    expect(Object.keys(body)).toEqual(["ok"]);
  });

  it("anonymous request returns 503 and ONLY { ok:false } while unhealthy", async () => {
    const spy = vi
      .spyOn(dbClient as unknown as { $queryRaw: (...a: unknown[]) => unknown }, "$queryRaw")
      .mockImplementation(() => Promise.reject(new Error("simulated outage")));
    try {
      const res = await anonGet();
      expect(res.status).toBe(503);
      const body = (await res.json()) as Health;
      expect(body).toEqual({ ok: false });
      expect(Object.keys(body)).toEqual(["ok"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("a wrong secret is treated as anonymous (no detail)", async () => {
    const res = await health.GET(
      new Request("https://autoeco.test/api/health", {
        headers: { authorization: "Bearer not-the-right-secret-value" },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Health;
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(body.ok).toBe(true);
  });

  it("authorized request exposes the full readiness report", async () => {
    const res = await authGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Health;
    expect(body.ok).toBe(true);
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.checks?.database.ok).toBe(true);
    expect(body.checks?.cron.ok).toBe(true);
    expect(body.checks?.errorMonitoring.ok).toBe(true);
    expect(Array.isArray(body.degraded)).toBe(true);
  });

  it("verbose adds warnings for authorized callers only", async () => {
    const body = (await (await authGet("?verbose=1")).json()) as Health;
    expect(Array.isArray(body.warnings)).toBe(true);
    const anon = (await (await anonGet("?verbose=1")).json()) as Health;
    expect(Object.keys(anon)).toEqual(["ok"]);
  });

  it("unset HEALTH_SECRET disables the detailed view for everyone", async () => {
    delete process.env.HEALTH_SECRET;
    try {
      const res = await authGet();
      expect(res.status).toBe(200);
      const body = (await res.json()) as Health;
      expect(Object.keys(body)).toEqual(["ok"]);
    } finally {
      process.env.HEALTH_SECRET = HEALTH_SECRET_VALUE;
    }
  });

  it("never discloses the secret, S3 endpoint, bucket name or credentials", async () => {
    const extra = [
      process.env.AUTH_SECRET,
      process.env.PADDLE_WEBHOOK_SECRET,
      process.env.CRON_SECRET,
    ].filter((v): v is string => Boolean(v));

    for (const res of [await anonGet("?verbose=1"), await authGet("?verbose=1")]) {
      const text = await res.text();
      for (const bit of [...SECRET_BITS, ...extra]) {
        expect(text).not.toContain(bit);
      }
    }
  });
});
