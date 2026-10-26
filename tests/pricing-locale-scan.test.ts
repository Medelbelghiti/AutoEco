import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const LOCALES_DIR = join(__dirname, "..", "src", "locales");
const LOCALE_FILES = ["en", "fr", "es", "pt-BR", "de", "ar"] as const;

describe("locale pricing strings are free of hardcoded currency amounts", () => {
  it("no locale file contains hardcoded currency prices like $6.99, $19.99, 12.99 USD", () => {
    const bad: string[] = [];
    for (const file of LOCALE_FILES) {
      const raw = readFileSync(join(LOCALES_DIR, `${file}.json`), "utf8");
      // Look for patterns like $6.99, 6.99/month, 19.99 USD
      if (/\$\d+\.\d{2}/.test(raw)) bad.push(`${file}.json has $X.XX`);
      if (/\b\d+\.\d{2}\s*(USD|EUR|GBP|\/month|per month)\b/i.test(raw)) bad.push(`${file}.json has amount with currency/period`);
      if (/\b6\.99\b|\b19\.99\b|\b12\.99\b/.test(raw)) bad.push(`${file}.json has known hardcoded prices`);
    }
    expect(bad).toEqual([]);
  });
});
