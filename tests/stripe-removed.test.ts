/**
 * Stripe is fully removed (Task 7). The schema keeps two legacy columns
 * (`stripeCustomerId`, `stripeInvoiceId`) that the Paddle code nulls/writes,
 * but no Stripe dependency, module, route or import may return. This is a
 * guard against a well-meaning "restore the old provider" change.
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

describe("Stripe has been removed", () => {
  it("is not a dependency", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const stripeDeps = Object.keys(deps).filter((d) => d === "stripe" || d.startsWith("@stripe/"));
    expect(stripeDeps).toEqual([]);
  });

  it("has no stripe-named module under src/", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => /stripe/i.test(path.basename(f)));
    expect(offenders).toEqual([]);
  });

  it("is not imported anywhere in src/", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => /(?:from|require\()\s*["']@?stripe["'/]/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("is not documented as an active env var", () => {
    const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    expect(example).not.toMatch(/STRIPE/i);
  });
});
