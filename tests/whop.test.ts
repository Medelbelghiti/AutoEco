/**
 * Pure unit tests (no database) for the Whop adapter in `src/lib/whop.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  verifyWhopSignature,
  signWhopPayload,
  whopMoneyToMinor,
  readCurrency,
  mapMembershipStatus,
  planKeyForWhopPlanId,
  whopConfigured,
  whopPlanPurchasable,
  whopApiBase,
  readPlanId,
  readUserId,
  readMembershipId,
  readMetadata,
  parseWhopDate,
  lifetimeMaxGrants,
} from "@/lib/whop";

const SECRET = "ws_unit_test_secret_0123456789abcdef";
const BODY = JSON.stringify({ id: "msg_1", type: "payment.succeeded", data: { id: "pay_1" } });
const NOW = 1_800_000_000;

describe("verifyWhopSignature (Standard Webhooks, literal ws_ key)", () => {
  const headers = (sig: string, ts = String(NOW), id = "msg_1") => ({ id, timestamp: ts, signature: sig });

  it("accepts a correct signature", () => {
    const sig = signWhopPayload(BODY, "msg_1", String(NOW), SECRET);
    expect(verifyWhopSignature(BODY, headers(sig), SECRET, 300, NOW)).toBe(true);
  });

  it("matches the documented scheme: HMAC over `${id}.${ts}.${body}` with the secret bytes as-is", () => {
    const expected = crypto.createHmac("sha256", SECRET).update(`msg_1.${NOW}.${BODY}`).digest("base64");
    expect(verifyWhopSignature(BODY, headers(`v1,${expected}`), SECRET, 300, NOW)).toBe(true);
  });

  it("rejects the Standard Webhooks library mistake (base64-decoding the secret)", () => {
    const decodedKey = Buffer.from(SECRET.replace(/^ws_/, ""), "base64");
    const wrong = crypto.createHmac("sha256", decodedKey).update(`msg_1.${NOW}.${BODY}`).digest("base64");
    expect(verifyWhopSignature(BODY, headers(`v1,${wrong}`), SECRET, 300, NOW)).toBe(false);
  });

  it("rejects a tampered body, a different id and a wrong secret", () => {
    const sig = signWhopPayload(BODY, "msg_1", String(NOW), SECRET);
    expect(verifyWhopSignature(BODY + " ", headers(sig), SECRET, 300, NOW)).toBe(false);
    expect(verifyWhopSignature(BODY, headers(sig, String(NOW), "msg_2"), SECRET, 300, NOW)).toBe(false);
    expect(verifyWhopSignature(BODY, headers(sig), "ws_other_secret_value_xxxxxxxx", 300, NOW)).toBe(false);
  });

  it("rejects replays outside the tolerance window, in both directions", () => {
    const old = String(NOW - 301);
    const future = String(NOW + 301);
    expect(verifyWhopSignature(BODY, headers(signWhopPayload(BODY, "msg_1", old, SECRET), old), SECRET, 300, NOW)).toBe(false);
    expect(verifyWhopSignature(BODY, headers(signWhopPayload(BODY, "msg_1", future, SECRET), future), SECRET, 300, NOW)).toBe(false);
  });

  it("accepts any matching v1 entry in a space-separated list (key rotation)", () => {
    const good = signWhopPayload(BODY, "msg_1", String(NOW), SECRET);
    expect(verifyWhopSignature(BODY, headers(`v1,AAAA ${good}`), SECRET, 300, NOW)).toBe(true);
  });

  it("fails closed on missing pieces and non-v1 schemes", () => {
    const sig = signWhopPayload(BODY, "msg_1", String(NOW), SECRET);
    expect(verifyWhopSignature(BODY, headers(sig), "", 300, NOW)).toBe(false);
    expect(verifyWhopSignature(BODY, { id: null, timestamp: String(NOW), signature: sig }, SECRET, 300, NOW)).toBe(false);
    expect(verifyWhopSignature(BODY, headers(sig, "not-a-number"), SECRET, 300, NOW)).toBe(false);
    expect(verifyWhopSignature(BODY, headers(sig.replace("v1,", "v2,")), SECRET, 300, NOW)).toBe(false);
  });
});

describe("whopMoneyToMinor", () => {
  it("reads the current Money object (major units, exact string)", () => {
    expect(whopMoneyToMinor({ amount: "6.99", currency: "usd", decimals: 2 })).toBe(699);
    expect(whopMoneyToMinor({ amount: "99.00", currency: "usd", decimals: 2 })).toBe(9900);
    expect(whopMoneyToMinor({ amount: "99", currency: "usd", decimals: 2 })).toBe(9900);
    expect(whopMoneyToMinor({ amount: "0.10", currency: "usd", decimals: 2 })).toBe(10);
  });
  it("reads legacy bare numbers in major units", () => {
    expect(whopMoneyToMinor(6.99)).toBe(699);
    expect(whopMoneyToMinor(19.99)).toBe(1999);
    expect(whopMoneyToMinor("19.99")).toBe(1999);
  });
  it("refuses values it cannot represent exactly", () => {
    expect(whopMoneyToMinor({ amount: "1.999", decimals: 2 })).toBeNull();
    expect(whopMoneyToMinor({ amount: "1.990", decimals: 2 })).toBe(199);
    expect(whopMoneyToMinor(null)).toBeNull();
    expect(whopMoneyToMinor({ currency: "usd" })).toBeNull();
    expect(whopMoneyToMinor(-1)).toBeNull();
  });
  it("upper-cases the currency and never invents one beyond USD", () => {
    expect(readCurrency({ amount: "1", currency: "eur" })).toBe("EUR");
    expect(readCurrency(null, "gbp")).toBe("GBP");
    expect(readCurrency(null, undefined)).toBe("USD");
  });
});

describe("mapMembershipStatus", () => {
  it("maps recurring statuses", () => {
    expect(mapMembershipStatus("active", false)).toEqual({ status: "active", cancelAtPeriodEnd: false });
    expect(mapMembershipStatus("trialing", false)).toEqual({ status: "trialing", cancelAtPeriodEnd: false });
    expect(mapMembershipStatus("canceling", false)).toEqual({ status: "active", cancelAtPeriodEnd: true });
    expect(mapMembershipStatus("past_due", false)?.status).toBe("past_due");
    expect(mapMembershipStatus("unresolved", false)?.status).toBe("past_due");
    expect(mapMembershipStatus("canceled", false)?.status).toBe("canceled");
    expect(mapMembershipStatus("expired", false)?.status).toBe("canceled");
    expect(mapMembershipStatus("completed", false)?.status).toBe("canceled");
  });
  it("maps a one-time lifetime membership", () => {
    expect(mapMembershipStatus("completed", true)?.status).toBe("lifetime");
    expect(mapMembershipStatus("active", true)?.status).toBe("lifetime");
    expect(mapMembershipStatus("canceled", true)?.status).toBe("canceled");
  });
  it("ignores statuses that should neither grant nor revoke", () => {
    expect(mapMembershipStatus("drafted", false)).toBeNull();
    expect(mapMembershipStatus(null, false)).toBeNull();
    expect(mapMembershipStatus("past_due", true)).toBeNull();
  });
});

describe("payload readers work across Whop API versions", () => {
  it("reads the plan id from variant_id, plan_id, or nested objects", () => {
    expect(readPlanId({ variant_id: "plan_a" })).toBe("plan_a");
    expect(readPlanId({ plan_id: "plan_b" })).toBe("plan_b");
    expect(readPlanId({ plan: { id: "plan_c" } })).toBe("plan_c");
    expect(readPlanId({ variant: { id: "plan_d" } })).toBe("plan_d");
    expect(readPlanId({})).toBeNull();
  });
  it("reads user, membership and metadata", () => {
    expect(readUserId({ user_id: "user_1" })).toBe("user_1");
    expect(readUserId({ user: { id: "user_2" } })).toBe("user_2");
    expect(readMembershipId({ id: "mem_1" }, true)).toBe("mem_1");
    expect(readMembershipId({ id: "pay_1", membership_id: "mem_2" }, false)).toBe("mem_2");
    expect(readMembershipId({ id: "pay_1", membership: { id: "mem_3" } }, false)).toBe("mem_3");
    expect(readMetadata({ metadata: { userId: "u1", planKey: "pro" } })).toEqual({ userId: "u1", planKey: "pro" });
    expect(readMetadata({ metadata: null })).toEqual({ userId: null, planKey: null });
  });
  it("parses ISO and unix-second timestamps", () => {
    expect(parseWhopDate("2026-11-26T10:00:00.000Z")?.toISOString()).toBe("2026-11-26T10:00:00.000Z");
    expect(parseWhopDate(1_800_000_000)?.getTime()).toBe(1_800_000_000_000);
    expect(parseWhopDate("garbage")).toBeNull();
    expect(parseWhopDate(undefined)).toBeNull();
  });
});

describe("configuration gates", () => {
  const KEYS = [
    "WHOP_API_KEY",
    "WHOP_WEBHOOK_SECRET",
    "WHOP_COMPANY_ID",
    "WHOP_PRO_PLAN_ID",
    "WHOP_PRO_PLUS_PLAN_ID",
    "WHOP_LIFETIME_PLAN_ID",
    "WHOP_ENV",
    "LIFETIME_MAX_GRANTS",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is off until every required piece is present", () => {
    expect(whopConfigured()).toBe(false);
    process.env.WHOP_API_KEY = "key";
    process.env.WHOP_WEBHOOK_SECRET = "ws_secret";
    process.env.WHOP_COMPANY_ID = "biz_1";
    expect(whopConfigured()).toBe(false); // no plan id yet
    process.env.WHOP_PRO_PLAN_ID = "plan_pro";
    expect(whopConfigured()).toBe(true);
    expect(whopPlanPurchasable("pro")).toBe(true);
    expect(whopPlanPurchasable("pro_plus")).toBe(false);
    expect(whopPlanPurchasable("family")).toBe(false);
  });

  it("maps plan ids both ways and never guesses an unknown plan", () => {
    process.env.WHOP_PRO_PLAN_ID = "plan_pro";
    process.env.WHOP_PRO_PLUS_PLAN_ID = "plan_plus";
    process.env.WHOP_LIFETIME_PLAN_ID = "plan_life";
    expect(planKeyForWhopPlanId("plan_pro")).toBe("pro");
    expect(planKeyForWhopPlanId("plan_plus")).toBe("pro_plus");
    expect(planKeyForWhopPlanId("plan_life")).toBe("lifetime");
    expect(planKeyForWhopPlanId("plan_someone_elses")).toBeNull();
    expect(planKeyForWhopPlanId("")).toBeNull();
  });

  it("defaults to the sandbox API and only goes live when told to", () => {
    expect(whopApiBase()).toBe("https://sandbox-api.whop.com/api/v1");
    process.env.WHOP_ENV = "production";
    expect(whopApiBase()).toBe("https://sandbox-api.whop.com/api/v1");
    process.env.WHOP_ENV = "live";
    expect(whopApiBase()).toBe("https://api.whop.com/api/v1");
  });

  it("treats a missing or invalid lifetime cap as zero (offer off)", () => {
    expect(lifetimeMaxGrants()).toBe(0);
    process.env.LIFETIME_MAX_GRANTS = "abc";
    expect(lifetimeMaxGrants()).toBe(0);
    process.env.LIFETIME_MAX_GRANTS = "100";
    expect(lifetimeMaxGrants()).toBe(100);
  });
});
