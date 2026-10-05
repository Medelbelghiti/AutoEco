/**
 * Pure unit tests (no database) for the fixes in the launch-hardening pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bytesMatchMime } from "@/lib/storage";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { paddleAmountToCents, normalizeInvoiceCurrency } from "@/lib/paddle";
import { getClientIp } from "@/lib/utils";

describe("Paddle amounts are already in minor units", () => {
  it("does not multiply by 100", () => {
    expect(paddleAmountToCents("699")).toBe(699);
    expect(paddleAmountToCents("1999")).toBe(1999);
    expect(paddleAmountToCents(1299)).toBe(1299);
  });
  it("is safe on garbage", () => {
    expect(paddleAmountToCents(undefined)).toBe(0);
    expect(paddleAmountToCents("abc")).toBe(0);
    expect(paddleAmountToCents("-5")).toBe(0);
  });
  it("keeps the real currency instead of coercing to USD", () => {
    expect(normalizeInvoiceCurrency("brl")).toBe("BRL");
    expect(normalizeInvoiceCurrency("INR")).toBe("INR");
    expect(normalizeInvoiceCurrency("not-a-code")).toBe("USD");
    expect(normalizeInvoiceCurrency(undefined)).toBe("USD");
  });
});

describe("supported currencies are all 2-decimal (amounts are stored as cents)", () => {
  it("every supported currency has exactly 2 minor-unit digits", () => {
    for (const c of SUPPORTED_CURRENCIES) {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits;
      expect(digits, c).toBe(2);
    }
  });
  it("has no duplicates", () => {
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length);
  });
});

describe("upload content sniffing", () => {
  const b = (...bytes: number[]) => Buffer.from([...bytes, ...new Array(16).fill(0)].slice(0, 16));
  it("accepts matching signatures", () => {
    expect(bytesMatchMime(b(0xff, 0xd8, 0xff), "image/jpeg")).toBe(true);
    expect(bytesMatchMime(b(0x89, 0x50, 0x4e, 0x47), "image/png")).toBe(true);
    expect(bytesMatchMime(b(0x25, 0x50, 0x44, 0x46), "application/pdf")).toBe(true);
  });
  it("rejects a script renamed to an image", () => {
    const html = Buffer.from("<script>alert(1)</script>");
    for (const m of ["image/jpeg", "image/png", "application/pdf", "image/webp", "image/heic"]) {
      expect(bytesMatchMime(html, m)).toBe(false);
    }
  });
  it("rejects unknown declared types", () => {
    expect(bytesMatchMime(b(0xff, 0xd8, 0xff), "text/html")).toBe(false);
  });
});

describe("getClientIp", () => {
  const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("prefers the platform header over a spoofable X-Forwarded-For prefix", () => {
    expect(getClientIp(req({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "6.6.6.6, 2.2.2.2" }))).toBe("1.1.1.1");
  });
  it("falls back to the proxy-appended (last) X-Forwarded-For entry", () => {
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 2.2.2.2" }))).toBe("2.2.2.2");
  });
  it("returns unknown when nothing is present", () => {
    expect(getClientIp(req({}))).toBe("unknown");
  });
});

describe("captcha", () => {
  const OLD = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...OLD }; vi.restoreAllMocks(); });

  it("is a no-op when not configured", async () => {
    delete process.env.CAPTCHA_PROVIDER;
    const { verifyCaptcha } = await import("@/lib/captcha");
    expect(await verifyCaptcha(undefined)).toBe(true);
  });

  it("fails closed when enabled and the token is missing", async () => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const { verifyCaptcha } = await import("@/lib/captcha");
    expect(await verifyCaptcha(undefined)).toBe(false);
  });

  it("fails closed when Cloudflare is unreachable", async () => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const { verifyCaptcha } = await import("@/lib/captcha");
    expect(await verifyCaptcha("tok")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("passes only when Cloudflare says success", async () => {
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    const { verifyCaptcha } = await import("@/lib/captcha");
    expect(await verifyCaptcha("tok", "1.2.3.4")).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("past_due grace window", () => {
  it("keeps access right after a failed renewal (period just ended)", async () => {
    const { isPastDueGraceActive } = await import("@/lib/grace");
    const now = new Date("2026-10-05T00:00:00Z");
    const periodEnd = new Date("2026-10-04T00:00:00Z"); // ended yesterday
    expect(isPastDueGraceActive(periodEnd, periodEnd, now)).toBe(true);
  });
  it("keeps access while the period is still in the future", async () => {
    const { isPastDueGraceActive } = await import("@/lib/grace");
    const now = new Date("2026-10-05T00:00:00Z");
    expect(isPastDueGraceActive(new Date("2026-10-20T00:00:00Z"), now, now)).toBe(true);
  });
  it("revokes after 14 days of grace", async () => {
    const { isPastDueGraceActive } = await import("@/lib/grace");
    const now = new Date("2026-10-30T00:00:00Z");
    const periodEnd = new Date("2026-10-04T00:00:00Z"); // 26 days ago
    expect(isPastDueGraceActive(periodEnd, periodEnd, now)).toBe(false);
  });
  it("falls back to updatedAt when there is no period end", async () => {
    const { isPastDueGraceActive } = await import("@/lib/grace");
    const now = new Date("2026-10-05T00:00:00Z");
    expect(isPastDueGraceActive(null, new Date("2026-10-01T00:00:00Z"), now)).toBe(true);
    expect(isPastDueGraceActive(null, new Date("2026-09-01T00:00:00Z"), now)).toBe(false);
  });
});
