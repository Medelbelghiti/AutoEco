#!/usr/bin/env node
/**
 * Local production smoke test.
 *
 * Boots the REAL production server (`next start` against an existing
 * `npx next build`) on a local port and drives the everyday user journeys plus
 * the security-critical edges over HTTP. Nothing here touches a remote service:
 * the database is a local disposable Postgres, receipt files go to a temp
 * directory, and email degrades to the console provider.
 *
 * It is intentionally a black-box test: it talks only to HTTP endpoints (and,
 * for setup/assertions, reads the local database directly), so it proves the
 * wired-together app works, not just individual functions.
 *
 * Usage:
 *   npx next build            # must exist first (this script does NOT build)
 *   node scripts/smoke.mjs
 *
 * Env (all optional, sensible local defaults):
 *   SMOKE_DATABASE_URL  local Postgres (default autoeco_test)
 *   SMOKE_PORT          server port (default 3199)
 *
 * Exits non-zero if any check fails. Every created user is deleted at the end.
 */
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = Number(process.env.SMOKE_PORT ?? 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.SMOKE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://autoeco:autoeco@127.0.0.1:5432/autoeco_test";
const AUTH_SECRET = "smoke-test-secret-0000000000000000000000000000";
const CRON_SECRET = "smoke-test-cron-secret-value";
const PADDLE_WEBHOOK_SECRET = "smoke-test-webhook-secret-value-0000";
// Must NOT start with `pdl_sdbx_`/`pdl_live_`, or the production boot audit
// flags it (sandbox key) and the server refuses to start.
const PADDLE_API_KEY = "local-smoke-apikey";
const PADDLE_PRO_PRICE_ID = "pri_smoke_pro";
const STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "autoeco-smoke-"));

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
}

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client
// ---------------------------------------------------------------------------
class Client {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some(
        (a) => /max-age=0/i.test(a.trim()) || /expires=thu,\s*01\s*jan\s*1970/i.test(a.trim())
      ) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

async function call(method, p, { client, json, form, headers = {}, redirect = "manual" } = {}) {
  const h = { ...headers };
  let body;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    body = form; // fetch sets the multipart boundary itself
  }
  if (client) {
    const cookie = client.header();
    if (cookie) h["cookie"] = cookie;
  }
  const res = await fetch(BASE + p, { method, headers: h, body, redirect });
  if (client) client.absorb(res);
  const text = await res.text();
  let data = null;
  try {
    body = undefined;
    json = undefined;
  } catch { /* noop */ }
  try {
    return { status: res.status, headers: res.headers, text, data: JSON.parse(text) };
  } catch {
    return { status: res.status, headers: res.headers, text, data: null };
  }
}

function sign(rawBody) {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac("sha256", PADDLE_WEBHOOK_SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

function pngBytes() {
  // Real PNG signature + IHDR bytes (enough for the magic-byte check).
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

function rid(n = 8) {
  return crypto.randomBytes(n).toString("hex");
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
let server;
async function startServer() {
  const childEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL,
    DIRECT_URL: DATABASE_URL,
    AUTH_SECRET,
    CRON_SECRET,
    PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET,
    PADDLE_SELLER_ID: "seller_smoke",
    PADDLE_PRO_PRICE_ID,
    PADDLE_ENV: "sandbox",
    EMAIL_PROVIDER: "console",
    STORAGE_DRIVER: "local",
    STORAGE_DIR,
    NEXT_PUBLIC_APP_URL: BASE,
  };
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", String(PORT)], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d.toString()));
  server.stderr.on("data", (d) => (log += d.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server exited early:\n${log}`);
    try {
      const res = await fetch(`${BASE}/api/health`, { redirect: "manual" });
      if (res.status) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`server did not become ready in 60s:\n${log}`);
}

function stopServer() {
  if (server && server.exitCode == null) {
    if (process.platform === "win32") {
      try { execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]); } catch { /* ignore */ }
    } else {
      server.kill("SIGTERM");
    }
  }
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------
const createdEmails = [];

async function flow() {
  console.log("\n[1] Anonymous readiness probe");
  {
    const res = await call("GET", "/api/health");
    check("health responds for anonymous caller", res.status === 200 || res.status === 503, `status=${res.status}`);
    let parsed = null;
    try { parsed = JSON.parse(res.text); } catch { /* ignore */ }
    check("health body is JSON with boolean checks", Boolean(parsed?.checks) && Object.values(parsed.checks).every((c) => typeof c.ok === "boolean"), res.text.slice(0, 120));
    const leaked = [AUTH_SECRET, CRON_SECRET, PADDLE_WEBHOOK_SECRET, "postgresql://"].some((s) => res.text.includes(s));
    check("health leaks no secret/connection string", !leaked);
  }

  console.log("\n[2] Signup");
  const free = new Client();
  const freeEmail = `smoke-free-${rid()}@example.com`;
  createdEmails.push(freeEmail);
  let freeUserId = null;
  {
    const res = await call("POST", "/api/auth/signup", {
      client: free,
      json: { name: "Smoke Free", email: freeEmail, password: "Smoke-pass-12345", captchaToken: "" },
    });
    check("signup returns 200", res.status === 200, `status=${res.status} ${res.text.slice(0, 120)}`);
    let body = null;
    try { body = JSON.parse(res.text); } catch { /* ignore */ }
    freeUserId = body?.user?.id ?? null;
    check("signup sets a session cookie", free.cookies.has("autoeco_session"), free.header());
    if (freeUserId) await prisma.user.update({ where: { id: freeUserId }, data: { emailVerifiedAt: new Date() } });
  }

  console.log("\n[3] Login (fresh client, correct + wrong password)");
  {
    const bad = await call("POST", "/api/auth/login", { json: { email: freeEmail, password: "wrong-password" } });
    check("login rejects wrong password with 401", bad.status === 401, `status=${bad.status}`);
    const login = new Client();
    const res = await call("POST", "/api/auth/login", { client: login, json: { email: freeEmail, password: "Smoke-pass-12345" } });
    check("login succeeds with 200", res.status === 200, `status=${res.status}`);
    check("login sets a session cookie", login.cookies.has("autoeco_session"));
    free.cookies = login.cookies; // keep the freshest session
  }

  console.log("\n[4] Vehicle, expense and trip");
  let vehicleId = null;
  {
    const v = await call("POST", "/api/vehicles", {
      client: free,
      json: { brand: "Toyota", model: "Corolla", year: 2020, fuelType: "petrol", isPrimary: true },
    });
    let body = null; try { body = JSON.parse(v.text); } catch { /* ignore */ }
    vehicleId = body?.id ?? body?.vehicle?.id ?? null;
    check("create vehicle returns 200 and an id", v.status === 200 && Boolean(vehicleId), `status=${v.status} ${v.text.slice(0, 120)}`);

    const e = await call("POST", "/api/expenses", {
      client: free,
      json: { vehicleId, category: "fuel", amountCents: 4200, currency: "USD", date: new Date().toISOString().slice(0, 10) },
    });
    check("create expense returns 200", e.status === 200, `status=${e.status} ${e.text.slice(0, 120)}`);

    const t = await call("POST", "/api/trips", {
      client: free,
      json: { vehicleId, date: new Date().toISOString().slice(0, 10), purpose: "business", distance: 12.5, distanceUnit: "km" },
    });
    check("create trip returns 201", t.status === 201, `status=${t.status} ${t.text.slice(0, 120)}`);
  }

  console.log("\n[5] Receipt upload (local disk)");
  {
    const form = new FormData();
    form.append("file", new Blob([pngBytes()], { type: "image/png" }), "receipt.png");
    if (vehicleId) form.append("vehicleId", vehicleId);
    form.append("category", "fuel");
    form.append("title", "Smoke receipt");
    const res = await call("POST", "/api/receipts", { client: free, form });
    check("receipt upload accepted (200)", res.status === 200, `status=${res.status} ${res.text.slice(0, 160)}`);
  }

  console.log("\n[6] PDF report entitlement");
  {
    const denied = await call("GET", `/api/reports/ownership-cost?vehicleId=${vehicleId}`, { client: free });
    check("free user PDF is 403", denied.status === 403, `status=${denied.status}`);

    const proEmail = `smoke-pro-${rid()}@example.com`;
    createdEmails.push(proEmail);
    const pro = new Client();
    const su = await call("POST", "/api/auth/signup", {
      client: pro,
      json: { name: "Smoke Pro", email: proEmail, password: "Smoke-pass-12345", captchaToken: "" },
    });
    let proBody = null; try { proBody = JSON.parse(su.text); } catch { /* ignore */ }
    const proUserId = proBody?.user?.id;
    const proPlan = await prisma.plan.findFirst({ where: { key: "pro" } });
    await prisma.subscription.create({
      data: {
        userId: proUserId,
        planId: proPlan.id,
        status: "active",
        paddleSubscriptionId: `sub_smoke_${rid()}`,
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        lastEventAt: new Date(),
      },
    });
    const pv = await call("POST", "/api/vehicles", {
      client: pro,
      json: { brand: "Mazda", model: "3", year: 2021, fuelType: "petrol" },
    });
    let pvBody = null; try { pvBody = JSON.parse(pv.text); } catch { /* ignore */ }
    const proVehicleId = pvBody?.id ?? pvBody?.vehicle?.id;
    const allowed = await call("GET", `/api/reports/ownership-cost?vehicleId=${proVehicleId}`, { client: pro });
    check("pro user PDF is 200", allowed.status === 200, `status=${allowed.status}`);
    check("pro PDF is application/pdf", (allowed.headers.get("content-type") ?? "").includes("application/pdf"));
  }

  console.log("\n[7] Language switch");
  {
    const res = await call("PATCH", "/api/profile", { client: free, json: { locale: "fr" } });
    let body = null; try { body = JSON.parse(res.text); } catch { /* ignore */ }
    check("profile locale PATCH returns 200", res.status === 200, `status=${res.status}`);
    check("locale persisted as fr", body?.locale === "fr", res.text.slice(0, 120));
  }

  console.log("\n[8] Sign out of all devices, then logout");
  {
    const all = await call("POST", "/api/auth/logout-all", { client: free });
    check("logout-all redirects 303", all.status === 303, `status=${all.status}`);
    const clearedAll = (all.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("autoeco_session="));
    check("logout-all clears the session cookie", clearedAll);
    const after = await call("GET", "/api/vehicles", { client: free });
    check("session is rejected after logout-all (401)", after.status === 401, `status=${after.status}`);

    const relog = new Client();
    const r = await call("POST", "/api/auth/login", { client: relog, json: { email: freeEmail, password: "Smoke-pass-12345" } });
    check("re-login after logout-all succeeds", r.status === 200, `status=${r.status}`);
    const out = await call("POST", "/api/auth/logout", { client: relog });
    check("logout redirects with 303", out.status === 303, `status=${out.status}`);
    const cleared = (out.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("autoeco_session="));
    check("logout clears the session cookie", cleared);
  }

  console.log("\n[9] Paddle webhook: forged rejected, replayed idempotent");
  {
    const bad = await call("POST", "/api/paddle/webhook", {
      headers: { "paddle-signature": "ts=1700000000;h1=deadbeefdeadbeef" },
      json: { event_id: "evt_forged", event_type: "transaction.completed", data: {} },
    });
    check("forged webhook rejected (400)", bad.status === 400, `status=${bad.status}`);

    const txId = `txn_smoke_${rid()}`;
    const payload = JSON.stringify({
      event_id: `evt_smoke_${rid()}`,
      event_type: "transaction.completed",
      occurred_at: new Date().toISOString(),
      data: {
        id: txId,
        customer_id: "ctm_smoke",
        currency_code: "USD",
        billed_at: new Date().toISOString(),
        custom_data: { userId: freeUserId },
        items: [{ price: { id: PADDLE_PRO_PRICE_ID } }],
        details: { totals: { grand_total: "699", currency_code: "USD" } },
      },
    });
    const first = await postSigned(payload);
    const second = await postSigned(payload);
    check("signed webhook accepted (200)", first.status === 200, `status=${first.status} ${first.text.slice(0, 120)}`);
    check("replayed webhook accepted idempotently (200)", second.status === 200, `status=${second.status}`);
    const count = await prisma.invoice.count({ where: { paddleOrderId: txId } });
    check("replay did not duplicate the invoice", count === 1, `count=${count}`);
  }

  console.log("\n[10] Cron routes require the secret");
  {
    const noAuth = await call("GET", "/api/cron/expire-subscriptions");
    check("cron without secret is 401", noAuth.status === 401, `status=${noAuth.status}`);
    const wrong = await call("GET", "/api/cron/expire-subscriptions", { headers: { authorization: "Bearer not-the-secret" } });
    check("cron with wrong secret is 401", wrong.status === 401, `status=${wrong.status}`);
  }
}

/** Sign a raw Paddle webhook body with a fresh timestamp (HMAC-SHA256). */
async function postSigned(rawBody) {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac("sha256", PADDLE_WEBHOOK_SECRET).update(`${ts}.${rawBody}`).digest("hex");
  const res = await fetch(`${BASE}/api/paddle/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${h1}` },
    body: rawBody,
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  console.log(`[smoke] db=${DATABASE_URL}  port=${PORT}  storage=${STORAGE_DIR}`);
  console.log("[setup] ensuring plans exist (idempotent seed)…");
  try {
    const tsxCli = require.resolve("tsx/cli");
    execFileSync(process.execPath, [tsxCli, "scripts/seed-plans.ts"], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  } catch (e) {
    console.warn("  (seed-plans failed; assuming plans already present)", e instanceof Error ? e.message : e);
  }
  await startServer();
  try {
    await flow();
  } finally {
    stopServer();
    await sleep(1000);
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } }).catch(() => {});
    }
    await prisma.$disconnect();
    fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== smoke summary: ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exit(1);
  }
  console.log("All smoke checks passed.");
}

main().catch(async (e) => {
  console.error("SMOKE CRASHED:", e);
  stopServer();
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
