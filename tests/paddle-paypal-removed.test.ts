/**
 * Paddle and PayPal were replaced by Whop (2.5). The schema keeps their
 * nullable legacy columns and the `PaymentOrder` table so historic rows
 * survive, but no SDK, module, route, script origin or env var may return.
 * Same idea as `stripe-removed.test.ts`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("Paddle and PayPal have been removed", () => {
  it("has no paddle- or paypal-named module or route under src/", () => {
    const offenders = walk(path.join(root, "src")).filter((f) => /paddle|paypal/i.test(path.relative(root, f)));
    expect(offenders).toEqual([]);
  });

  it("is not imported anywhere in src/", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => /(?:from|require\()\s*["'][^"']*(paddle|paypal)/i.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("loads no Paddle or PayPal script and allows none in the CSP", () => {
    const config = fs.readFileSync(path.join(root, "next.config.mjs"), "utf8");
    expect(config).not.toMatch(/paddle\.com|paypal\.com|paypalobjects\.com/i);
  });

  it("documents only Whop as the payment provider in .env.example", () => {
    const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    expect(example).not.toMatch(/^\s*(NEXT_PUBLIC_)?PADDLE_/m);
    expect(example).not.toMatch(/^\s*PAYPAL_/m);
    expect(example).toMatch(/^WHOP_WEBHOOK_SECRET=/m);
  });
});
