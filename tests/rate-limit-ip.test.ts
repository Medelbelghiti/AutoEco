/**
 * Rate-limit keys must derive from an IP the caller cannot forge (Task 6).
 *
 * `/api/csp-report` is unauthenticated and writes to the audit log, so its
 * limiter is the only thing between a spammer and the log. If the key came from
 * the first `X-Forwarded-For` entry — attacker-controlled — a spammer could
 * send a brand-new fake IP per request and never be throttled. These tests
 * drive the real route and prove a rotating spoofed prefix still gets blocked.
 *
 * Content-Type is left as text/plain so the report is classified "unknown" and
 * the route returns before persisting anything: the limiter runs first, so the
 * counter (not the audit log) is what is under test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

const rnd = () => Math.floor(Math.random() * 200) + 1;
const trustedIp = `203.0.113.${rnd()}`;
const fallbackLastIp = `198.51.100.${rnd()}`;
const APP = "https://autoeco.test";

runSuite("rate-limit IP safety (real DB)", () => {
  let cspReport: typeof import("@/app/api/csp-report/route");

  beforeAll(async () => {
    cspReport = await import("@/app/api/csp-report/route");
  });

  beforeEach(async () => {
    // The route warns once per report; 120 expected warnings is just noise.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await prisma.rateLimitEntry.deleteMany({ where: { key: { in: [`csp:${trustedIp}`, `csp:${fallbackLastIp}`] } } });
  });

  afterAll(async () => {
    await prisma.rateLimitEntry.deleteMany({ where: { key: { in: [`csp:${trustedIp}`, `csp:${fallbackLastIp}`] } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function hit(headers: Record<string, string>) {
    return cspReport.POST(new Request(`${APP}/api/csp-report`, { method: "POST", headers, body: "" }));
  }

  run("a rotating spoofed X-Forwarded-For prefix cannot bypass the limit", async () => {
    // Same trusted platform IP every time, different fake prefixes.
    for (let i = 0; i < 60; i++) {
      const res = await hit({ "x-vercel-forwarded-for": trustedIp, "x-forwarded-for": `10.0.0.${i}, 1.1.1.1` });
      expect(res.status, `request ${i}`).toBe(204);
    }
    const blocked = await hit({ "x-vercel-forwarded-for": trustedIp, "x-forwarded-for": "10.0.0.99, 1.1.1.1" });
    expect(blocked.status).toBe(429);
  });

  run("without the platform header it keys on the proxy-appended (last) hop, not the spoofed first hop", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await hit({ "x-forwarded-for": `10.0.0.${i}, ${fallbackLastIp}` });
      expect(res.status, `request ${i}`).toBe(204);
    }
    const blocked = await hit({ "x-forwarded-for": `10.0.0.99, ${fallbackLastIp}` });
    expect(blocked.status).toBe(429);
  });
});
