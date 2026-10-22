import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  extractLegalPlaceholders,
  legalIsDraft,
  readLegalFile,
} from "@/components/LegalPage";

const LEGAL_DIR = path.join(process.cwd(), "legal");
const PAGES = [
  { file: "terms.md", route: "/terms" },
  { file: "privacy.md", route: "/privacy" },
  { file: "refund-policy.md", route: "/refund-policy" },
  { file: "acceptable-use.md", route: "/acceptable-use" },
];

describe("legal placeholder detection", () => {
  it("recognises bracketed tokens and ignores the documented convention", () => {
    const md = [
      "Operated by `[SQUARE_BRACKET]`.",
      "Contact `[CONTACT EMAIL]`.",
      "Entity: [LEGAL ENTITY NAME].",
      "Window: [REFUND_WINDOW_DAYS].",
    ].join("\n");
    expect(extractLegalPlaceholders(md)).toEqual([
      "[CONTACT EMAIL]",
      "[LEGAL ENTITY NAME]",
      "[REFUND_WINDOW_DAYS]",
    ]);
    expect(legalIsDraft(md)).toBe(true);
  });

  it("clears automatically once every token is replaced", () => {
    const md = "Operated by AutoEco SAS of 1 rue Example. Refunds within 14 days.";
    expect(extractLegalPlaceholders(md)).toEqual([]);
    expect(legalIsDraft(md)).toBe(false);
  });

  it("treats a missing file as not a draft rather than crashing", async () => {
    await expect(readLegalFile("does-not-exist.md")).resolves.toBe("");
  });

  it("is a draft today — this is the live launch blocker, asserted on purpose", () => {
    for (const { file } of PAGES) {
      const raw = fs.readFileSync(path.join(LEGAL_DIR, file), "utf8");
      const tokens = extractLegalPlaceholders(raw);
      expect(tokens.length, `${file} has no placeholders`).toBeGreaterThan(0);
      expect(legalIsDraft(raw), file).toBe(true);
    }
  });

  it("every public legal route reads a real file from legal/", () => {
    for (const { file } of PAGES) {
      expect(fs.existsSync(path.join(LEGAL_DIR, file)), file).toBe(true);
    }
  });
});
