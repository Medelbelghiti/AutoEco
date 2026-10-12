/**
 * Cron route method + auth (Task 4).
 *
 * Vercel Cron triggers the configured path with an HTTP **GET**. These routes
 * previously exported only `POST`, so on Vercel every scheduled run answered
 * 405 and never executed. Both GET and POST must be handled and share the same
 * `CRON_SECRET` bearer guard; an unset secret must fail closed (503).
 *
 * Real-DB test (the handlers query the DB). Skipped when DATABASE_URL is not
 * local — see ./\_dbGuard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();

const SECRET = "cron_test_secret_at_least_16_chars";
process.env.CRON_SECRET = SECRET;

type Route = {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
};
type Routes = Record<string, Route>;
let routes: Routes = {};

function req(url: string, method: string, auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request(url, { method, headers });
}

const run = DB_OK ? it : it.skip;

const PATHS: [string, string][] = [
  ["trial-ending", "/api/cron/trial-ending"],
  ["expire-subscriptions", "/api/cron/expire-subscriptions"],
  ["purge-deleted", "/api/cron/purge-deleted"],
];

describe("cron routes: GET (Vercel) and POST both work, auth fails closed", () => {
  beforeAll(async () => {
    routes = {
      "trial-ending": (await import("@/app/api/cron/trial-ending/route")) as unknown as Route,
      "expire-subscriptions": (await import("@/app/api/cron/expire-subscriptions/route")) as unknown as Route,
      "purge-deleted": (await import("@/app/api/cron/purge-deleted/route")) as unknown as Route,
    };
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "action" LIKE 'cron.%'`);
    await prisma.$disconnect();
  });

  for (const [name, path] of PATHS) {
    run(`${name}: GET is handled (not 405) and runs when authorised`, async () => {
      const res = await routes[name].GET(req(`https://autoeco.test${path}`, "GET", `Bearer ${SECRET}`));
      expect(res.status).toBe(200);
    });

    run(`${name}: POST is still handled`, async () => {
      const res = await routes[name].POST(req(`https://autoeco.test${path}`, "POST", `Bearer ${SECRET}`));
      expect(res.status).toBe(200);
    });

    run(`${name}: GET without a token is 401, never runs`, async () => {
      const res = await routes[name].GET(req(`https://autoeco.test${path}`, "GET"));
      expect(res.status).toBe(401);
    });

    run(`${name}: GET with a wrong token is 401`, async () => {
      const res = await routes[name].GET(req(`https://autoeco.test${path}`, "GET", "Bearer wrong-secret-value"));
      expect(res.status).toBe(401);
    });
  }

  run("an unset CRON_SECRET fails closed with 503 (GET and POST)", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect((await routes["trial-ending"].GET(req("https://autoeco.test/api/cron/trial-ending", "GET"))).status).toBe(503);
      expect((await routes["trial-ending"].POST(req("https://autoeco.test/api/cron/trial-ending", "POST"))).status).toBe(503);
    } finally {
      process.env.CRON_SECRET = prev;
    }
  });
});
