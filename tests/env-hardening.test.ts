import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProdSafety, assertProdOnBoot } from "@/lib/env";

// `@types/node` types NODE_ENV as readonly; mutate it through a writable view.
const nodeEnv = process.env as { NODE_ENV?: string };

/**
 * The production boot audit must fail fast on a missing or short AUTH_SECRET,
 * and read the secret live from process.env so a secret injected after
 * module load is still picked up. These tests deliberately flip NODE_ENV at
 * runtime; `assertProdSafety` gates on the live value, not the module-load
 * snapshot.
 */
describe("production AUTH_SECRET fail-fast", () => {
  const SAVED: Record<string, string | undefined> = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    PADDLE_API_KEY: process.env.PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("flags a missing AUTH_SECRET in production", () => {
    nodeEnv.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    const problems = assertProdSafety();
    expect(problems.some((p) => p.includes("AUTH_SECRET"))).toBe(true);
  });

  it("flags an AUTH_SECRET shorter than 32 bytes in production", () => {
    nodeEnv.NODE_ENV = "production";
    process.env.AUTH_SECRET = "too-short";
    const problems = assertProdSafety();
    expect(problems.some((p) => p.includes("AUTH_SECRET"))).toBe(true);
  });

  it("accepts a strong AUTH_SECRET in production", () => {
    nodeEnv.NODE_ENV = "production";
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.PADDLE_API_KEY = "";
    process.env.PADDLE_WEBHOOK_SECRET = "";
    expect(assertProdSafety()).toEqual([]);
  });

  it("never complains outside production", () => {
    nodeEnv.NODE_ENV = "test";
    delete process.env.AUTH_SECRET;
    expect(assertProdSafety()).toEqual([]);
  });

  it("reads the secret live from process.env, not a module-load snapshot", () => {
    nodeEnv.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    expect(assertProdSafety().some((p) => p.includes("AUTH_SECRET"))).toBe(true);

    // Inject the secret after the check started failing, as an environment
    // manager would at deploy time, and prove the next read picks it up.
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    expect(assertProdSafety().some((p) => p.includes("AUTH_SECRET"))).toBe(false);
  });

  it("throws on boot in production when AUTH_SECRET is missing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      nodeEnv.NODE_ENV = "production";
      delete process.env.AUTH_SECRET;
      expect(() => assertProdOnBoot()).toThrow(/AUTH_SECRET/);
    } finally {
      err.mockRestore();
    }
  });

  it("does not throw outside production", () => {
    nodeEnv.NODE_ENV = "test";
    delete process.env.AUTH_SECRET;
    expect(() => assertProdOnBoot()).not.toThrow();
  });
});
