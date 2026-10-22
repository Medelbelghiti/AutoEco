import { describe, expect, it } from "vitest";
import {
  APP_PREFIXES,
  AUTH_PAGES,
  classifyPagePath,
  isAppPath,
  isPublicPath,
} from "@/lib/route-access";

describe("route classification", () => {
  it("keeps the marketing and legal surface public", () => {
    for (const p of [
      "/",
      "/pricing",
      "/features",
      "/faq",
      "/docs",
      "/calculators/car-cost",
      "/terms",
      "/privacy",
      "/refund-policy",
      "/acceptable-use",
      "/affiliate-terms",
      "/login",
      "/signup",
      "/verify-email",
      "/share/abc123",
      "/api/track",
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("treats the whole app section as private", () => {
    for (const p of [
      "/dashboard",
      "/garage",
      "/garage/new",
      "/expenses/abc",
      "/fuel",
      "/insights",
      "/financial-twin",
      "/scenarios",
      "/reports",
      "/receipts",
      "/assistant",
      "/settings/billing",
      "/onboarding",
      "/trips/abc/edit",
    ]) {
      expect(isAppPath(p), p).toBe(true);
      expect(classifyPagePath(p), p).toBe("app");
    }
  });

  it("classifies the API tree as public so the middleware never HTML-redirects it", () => {
    // API routes authenticate themselves and must answer JSON 401s; the
    // middleware only ever sets headers on them.
    expect(isPublicPath("/api")).toBe(true);
    expect(isPublicPath("/api/track")).toBe(true);
    expect(isPublicPath("/api/paypal/webhook")).toBe(true);
  });

  it("does not let the public '/' entry open up unrelated top-level routes", () => {
    // The '/" prefix must stay an exact match, otherwise every path would be
    // public and the app would be wide open.
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/anything-else")).toBe(false);
    expect(isPublicPath("/")).toBe(true);
  });

  it("classifies auth pages separately so signed-in users are bounced off them", () => {
    for (const p of AUTH_PAGES) {
      expect(classifyPagePath(p)).toBe("auth");
    }
    // A sub-path of an auth page is not itself an auth page; it falls through
    // to the router, which 404s it (it is a public prefix).
    expect(classifyPagePath("/login/extra")).toBe("public");
  });

  it("returns 'missing' for unknown paths — a real 404, never a login redirect", () => {
    for (const p of [
      "/nonexistent-xyz",
      "/en/pricing",
      "/favicon.png",
      "/terms-and-conditions",
      "/garageeeee",
      "/share-anything",
    ]) {
      expect(classifyPagePath(p), p).toBe("missing");
    }
  });

  it("lets unknown sub-paths of a public prefix through so they 404 in the router", () => {
    // They are "public" only in the sense that no login redirect is issued;
    // the route still does not exist and Next renders not-found.tsx with a
    // 404 status.
    expect(classifyPagePath("/pricing/typo")).toBe("public");
  });

  it("never classifies a missing path as public or app (the two redirecting cases)", () => {
    const missing = classifyPagePath("/nope");
    expect(["public", "app"]).not.toContain(missing);
  });

  it("exposes a non-empty app prefix list that covers every (app) section", () => {
    expect(APP_PREFIXES.length).toBeGreaterThan(5);
    expect(new Set(APP_PREFIXES).size).toBe(APP_PREFIXES.length);
    for (const p of APP_PREFIXES) {
      expect(p.startsWith("/"), p).toBe(true);
    }
  });
});
