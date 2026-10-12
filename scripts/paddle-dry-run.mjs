#!/usr/bin/env node
/**
 * Paddle webhook dry-run.
 *
 * Replays a realistic Paddle Billing lifecycle against the REAL webhook route
 * using locally signed fixtures (HMAC-SHA256). No Paddle account, no network
 * call to Paddle is required: every request is signed in-process with the same
 * secret the server verifies against.
 *
 * It exercises the exact sequence the owner asked for:
 *   created → completed ("699" USD) → past_due → recovered → partial refund
 *   → full refund of the latest transaction → canceled
 *   plus an out-of-order replay and an unknown price id.
 *
 * After every step it prints the resulting Subscription / Invoice / plan state
 * read straight from the database — those rows ARE the entitlement source of
 * truth (there is no separate cache).
 *
 * Usage:
 *   node scripts/paddle-dry-run.mjs               # boots a local prod server
 *   PADDLE_DRY_RUN_BASE=http://127.0.0.1:3200 node scripts/paddle-dry-run.mjs
 *
 * The database is a local disposable Postgres (default autoeco_test).
 * The created user is deleted at the end. Exits non-zero on any unexpected
 * webhook response.
 */
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const PORT = Number(process.env.PADDLE_DRY_RUN_PORT ?? 3200);
const BASE = process.env.PADDLE_DRY_RUN_BASE ?? `http://127.0.0.1:${PORT}`;
const BOOT = !process.env.PADDLE_DRY_RUN_BASE;
const DATABASE_URL =
  process.env.SMOKE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://autoeco:autoeco@127.0.0.1:5432/autoeco_test";

const AUTH_SECRET = "paddle-dry-run-secret-0000000000000000000000";
const CRON_SECRET = "paddle-dryrun-cron-secret";
const PADDLE_WEBHOOK_SECRET = "dry-run-webhook-secret-000000000000000";
const PADDLE_API_KEY = "local-dryrun-apikey"; // must not start with pdl_
const PRO_PRICE = "pri_dryrun_pro";
const FAMILY_PRICE = "pri_dryrun_family";
const PLUS_PRICE = "pri_dryrun_plus";

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();

let failures = 0;
function assert(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`    ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
}

// ---------------------------------------------------------------------------
// Server lifecycle (only when not pointed at an existing one)
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
    PADDLE_API_KEY: "local-dryrun-apikey",
    PADDLE_WEBHOOK_SECRET: "dryrun-webhook-secret-000000000000000",
    PADDLE_SELLER_ID: "seller_dryrun",
    PADDLE_PRO_PRICE_ID: PRO_PRICE,
    PADDLE_FAMILY_PRICE_ID: "pri_dryrun_family",
    PADDLE_BUSINESS_PRICE_ID: PLUS_PRICE,
    PADDLE_ENV: "sandbox",
    EMAIL_PROVIDER: "console",
    STORAGE_DRIVER: "local",
    STORAGE_DIR: path.join(os.tmpdir(), "autoeco-dryrun-storage"),
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
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
      const res = await fetch(`${BASE}/api/health`);
      if (res.status) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`server not ready in 60s:\n${log}`);
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
// Signing + delivery
// ---------------------------------------------------------------------------
function sign(rawBody) {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac("sha256", "dryrun-webhook-secret-000000000000000").update(`${ts}.${rawBody}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

async function deliver(label, payload) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BASE}/api/paddle/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "paddle-signature": sign(raw) },
    body: raw,
  });
  let body = {};
  try { body = await res.json(); } catch { /* ignore */ }
  console.log(`\n> ${label}  [${payload.event_type}]  HTTP ${res.status} ${JSON.stringify(body)}`);
  assert(`${label}: accepted (2xx)`, res.status >= 200 && res.status < 300, `status=${res.status}`);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
const iso = (d = new Date()) => d.toISOString();
const older = (mins) => new Date(Date.now() - mins * 60_000).toISOString();
const eid = (tag) => `evt_dryrun_${tag}_${crypto.randomBytes(6).toString("hex")}`;

function state() {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { subscriptions: true, invoices: { orderBy: { createdAt: "asc" } }, plan: true },
  });
}

async function printState(title) {
  const u = await state();
  console.log(`    plan=${u?.plan?.key}  subs=[${(u?.subscriptions ?? []).map((s) => `${s.status}(${s.paddleSubscriptionId?.slice(-6)})`).join(", ")}]`);
  for (const inv of u?.invoices ?? []) {
    console.log(`    invoice ${inv.paddleOrderId.slice(-6)} amount=${inv.amountCents}${inv.currency} status=${inv.status} refunded=${inv.refundedAmountCents}`);
  }
  console.log(`    (${title})`);
}

let userId;
const CUST = "ctm_dryrun_1";
const SUB = "sub_dryrun_1";
const TX = "txn_dryrun_1";

const PRO = () => ({ price: { id: PRO_PRICE } });
const withUser = (data) => ({ ...data, custom_data: { userId, planKey: "pro" } });

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------
async function run() {
  // Create a clean local user.
  const email = `paddle-dryrun-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const free = await prisma.plan.findFirst({ where: { key: "free" } });
  const user = await prisma.user.create({
    data: { name: "Paddle DryRun", email, passwordHash: "x", planId: free?.id ?? null },
  });
  userId = user.id;
  console.log(`dry-run user ${userId} (${email})`);

  console.log("\n================ STEP 1: subscription.created ================");
  await deliver("created", {
    event_id: eid("created"), event_type: "subscription.created", occurred_at: iso(),
    data: withUser({
      id: SUB, subscription_id: SUB, customer_id: CUST, status: "active",
      items: [PRO()],
      current_billing_period: { starts_at: iso(), ends_at: iso(new Date(Date.now() + 30 * 86_400_000)) },
      next_billed_at: iso(new Date(Date.now() + 30 * 86_400_000)),
    }),
  });
  await printState("expect: plan=pro, one active subscription");
  {
    const u = await state();
    assert("plan upgraded to pro", u?.plan?.key === "pro", `plan=${u?.plan?.key}`);
    assert("subscription is active", u?.subscriptions?.[0]?.status === "active");
  }

  console.log("\n================ STEP 2: transaction.completed (699 USD) ================");
  await deliver("completed", {
    event_id: eid("completed"), event_type: "transaction.completed", occurred_at: iso(),
    data: withUser({
      id: TX, subscription_id: SUB, customer_id: CUST, currency_code: "USD", billed_at: iso(),
      items: [PRO()],
      details: { totals: { grand_total: "699", currency_code: "USD" } },
    }),
  });
  {
    const inv = await prisma.invoice.findUnique({ where: { paddleOrderId: TX } });
    assert("invoice created", Boolean(inv));
    assert("amount recorded as 699 cents (NOT 69900)", inv?.amountCents === 699, `amount=${inv?.amountCents}`);
    assert("invoice currency is USD", inv?.currency === "USD");
    assert("invoice marked paid", inv?.status === "paid", `status=${inv?.status}`);
  }
  await printState("paid pro subscription, one paid invoice");

  console.log("\n================ STEP 2b: transaction replay idempotency ================");
  {
    const p = {
      event_id: eid("txn_replay"), event_type: "transaction.completed", occurred_at: iso(),
      data: withUser({ id: TX, subscription_id: SUB, customer_id: CUST, currency_code: "USD", billed_at: iso(), items: [PRO()], details: { totals: { grand_total: "699", currency_code: "USD" } } }),
    };
    await deliver("tx (repeat 1)", p);
    await deliver("tx (repeat 2, same event_id)", p);
    const count = await prisma.invoice.count({ where: { paddleOrderId: TX } });
    assert("replay did not duplicate the invoice", count === 1, `count=${count}`);
  }

  console.log("\n================ STEP 3: past_due ================");
  await deliver("past_due", {
    event_id: eid("pastdue"), event_type: "subscription.past_due", occurred_at: iso(),
    data: withUser({ subscription_id: SUB, customer_id: CUST, status: "past_due" }),
  });
  await printState("subscription past_due (grace applies)");

  console.log("\n================ STEP 4: recovered (subscription.resumed) ================");
  await deliver("resumed", {
    event_id: eid("resumed"), event_type: "subscription.resumed", occurred_at: iso(),
    data: withUser({
      subscription_id: SUB, customer_id: CUST, status: "active",
      current_billing_period: { starts_at: iso(), ends_at: iso(new Date(Date.now() + 30 * 86_400_000)) },
      next_billed_at: iso(new Date(Date.now() + 30 * 86_400_000)),
    }),
  });
  await printState("subscription active again");

  console.log("\n================ STEP 5: partial refund ================");
  await deliver("partial refund", {
    event_id: eid("adj_partial"), event_type: "adjustment.created", occurred_at: iso(),
    data: withUser({ id: "adj_dryrun_partial", action: "refund", status: "approved", type: "partial", transaction_id: TX, currency_code: "USD", totals: { total: "200", currency_code: "USD" } }),
  });
  {
    const inv = await prisma.invoice.findUnique({ where: { paddleOrderId: TX } });
    console.log(`    invoice.status=${inv?.status} refunded=${inv?.refundedAmountCents}`);
    assert("partial refund recorded, access kept", inv?.status === "partially_refunded" && inv.refundedAmountCents === 200, `status=${inv?.status} refunded=${inv?.refundedAmountCents}`);
  }

  console.log("\n================ STEP 6: full refund of latest transaction ================");
  await deliver("full refund", {
    event_id: eid("adj_full"), event_type: "adjustment.created", occurred_at: iso(),
    data: withUser({ id: "adj_dryrun_full", action: "refund", status: "approved", type: "full", transaction_id: TX, currency_code: "USD", totals: { total: "499", currency_code: "USD" } }),
  });
  {
    const inv = await prisma.invoice.findUnique({ where: { paddleOrderId: TX } });
    console.log(`    invoice.status=${inv?.status} refunded=${inv?.refundedAmountCents}  (cancel attempted; see audit log)`);
    assert("invoice fully refunded", inv?.status === "refunded" && inv.refundedAmountCents === 699, `status=${inv?.status} refunded=${inv?.refundedAmountCents}`);
  }

  console.log("\n================ STEP 7: canceled ================");
  const canceledPayload = {
    event_id: eid("canceled"), event_type: "subscription.canceled", occurred_at: iso(),
    data: withUser({ subscription_id: SUB, customer_id: CUST, status: "canceled" }),
  };
  await deliver("canceled", canceledPayload);
  await printState("subscription canceled, downgraded to free");

  console.log("\n================ STEP 8: out-of-order replay ================");
  await deliver("stale subscription.updated (earlier occurred_at)", {
    event_id: eid("stale_update"), event_type: "subscription.updated", occurred_at: older(60),
    data: withUser({ subscription_id: SUB, customer_id: CUST, status: "active", items: [PRO()] }),
  });
  {
    const sub = await prisma.subscription.findUnique({ where: { paddleSubscriptionId: SUB } });
    assert("stale event did not resurrect the canceled subscription", sub?.status === "canceled", `status=${sub?.status}`);
  }
  await deliver("exact replay of the canceled event", canceledPayload);
  await printState("state unchanged after replays");

  console.log("\n================ STEP 9: unknown price id ================");
  const unknownSub = "sub_dryrun_unknown";
  await deliver("subscription.created with unknown price", {
    event_id: eid("unknown_price"), event_type: "subscription.created", occurred_at: iso(),
    data: withUser({ subscription_id: unknownSub, customer_id: "ctm_dryrun_unknown", status: "active", items: [{ price: { id: "pri_legacy_lifetime_not_in_catalog" } }] }),
  });
  {
    const sub = await prisma.subscription.findUnique({ where: { paddleSubscriptionId: unknownSub } });
    assert("unknown price id granted no subscription", sub === null, `sub=${sub?.status}`);
  }
  await printState("no entitlement from unknown price (owner reconciles via audit log)");
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`[paddle-dry-run] base=${BASE}${server ? "" : ""} db=${DATABASE_URL}`);
  if (!process.env.PADDLE_DRY_RUN_BASE) {
    console.log("[setup] ensuring plans exist (idempotent seed)…");
    try {
      const tsxCli = require.resolve("tsx/cli");
      execFileSync(process.execPath, [tsxCli, "scripts/seed-plans.ts"], { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
    } catch (e) {
      console.warn("  (seed-plans failed; assuming plans present)", e instanceof Error ? e.message : e);
    }
    await startServer();
  }
  try {
    await run();
  } finally {
    stopServer();
    await sleep(500);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }
  console.log(`\n==== paddle-dry-run: ${failures === 0 ? "all checks passed" : `${failures} FAILED`} ====`);
  if (failures) process.exit(1);
}

main().catch(async (e) => {
  console.error("DRY-RUN CRASHED:", e);
  stopServer();
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
