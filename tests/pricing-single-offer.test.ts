import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("pricing page is single offer only", () => {
  it("pricing page has no Pro Plus/Family/monthly references", () => {
    const src = readFileSync(join(__dirname, "..", "src", "app", "pricing", "page.tsx"), "utf8");
    expect(src).not.toMatch(/Pro Plus/i);
    expect(src).not.toMatch(/Family/i);
    expect(src).not.toMatch(/\/month/);
    expect(src).not.toMatch(/per month/i);
    expect(src).not.toMatch(/\$6\.99/);
    expect(src).not.toMatch(/\$19\.99/);
  });

  it("faq has no hardcoded monthly prices", () => {
    const src = readFileSync(join(__dirname, "..", "src", "app", "faq", "page.tsx"), "utf8");
    expect(src).not.toMatch(/\$6\.99/);
    expect(src).not.toMatch(/\$19\.99/);
    expect(src).not.toMatch(/\/month/);
  });
});
