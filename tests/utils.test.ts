import { describe, it, expect } from "vitest";
import { generateReferralCode, csvCell, currentMonthKey, currentDayKey } from "@/lib/utils";

describe("utils", () => {
  it("generateReferralCode has AUTOECO- prefix", () => {
    const code = generateReferralCode("Alice");
    expect(code.startsWith("AUTOECO-")).toBe(true);
    expect(code.length).toBeGreaterThanOrEqual(14);
  });

  it("csvCell handles quotes and commas", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell("hello, world")).toBe('"hello, world"');
    expect(csvCell('with "quote"')).toBe('"with ""quote"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("period keys are YYYY-MM and YYYY-MM-DD", () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    expect(currentMonthKey(d)).toBe("2026-01");
    expect(currentDayKey(d)).toBe("2026-01-15");
  });
});
