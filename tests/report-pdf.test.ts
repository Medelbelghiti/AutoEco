/**
 * PDF report: text safety and layout.
 *
 * The PDF is drawn with WinAnsi standard fonts, which have a much smaller
 * repertoire than the UI. So the assertions here fall into two groups:
 *
 *  - "this input must not throw": pdf-lib *throws* on an unencodable code
 *    point rather than substituting, so one vehicle named in Arabic or emoji
 *    would otherwise turn every download into a 500.
 *  - "this output must be readable": money carries an ISO code, the filename
 *    cannot escape its directory, and long text wraps instead of overflowing.
 *
 * Every sanitized sample is also pushed through the real font's encoder at the
 * end of the file, so the allowlist in pdf-safe.ts cannot silently drift from
 * what pdf-lib actually accepts.
 */
import { describe, it, expect } from "vitest";
import { toPdfSafe, pdfFilenameStem, PDF_MAX_LABEL } from "@/lib/pdf-safe";
import {
  wrapText,
  ellipsize,
  mm,
  contentBox,
  layoutTable,
  PAGE,
  LEADING,
  PDF_FOOTER_DISCLAIMER,
  footerLines,
  type PdfFontLike,
} from "@/lib/report-pdf-layout";
import { pdfMoney } from "@/lib/report-pdf";

/**
 * A font stub with roughly Helvetica metrics (average advance ~0.5em), so
 * wrapping can be tested without embedding anything.
 */
const stubFont: PdfFontLike = {
  widthOfTextAtSize: (text, size) => text.length * size * 0.5,
};

describe("toPdfSafe: never throws", () => {
  const hostile: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["number", 42],
    ["object", { a: 1 }],
    ["array", [1, 2, 3]],
    ["boolean", true],
  ];

  for (const [label, input] of hostile) {
    it(`returns a string for ${label}`, () => {
      expect(typeof toPdfSafe(input)).toBe("string");
    });
  }

  it("survives an object whose toString throws", () => {
    const evil = {
      toString() {
        throw new Error("boom");
      },
    };
    expect(toPdfSafe(evil)).toBe("");
  });

  it("survives a string with a lone surrogate", () => {
    // A truncated emoji: a single high surrogate with no pair.
    const out = toPdfSafe("car \ud800 end");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("\ud800");
  });

  it("survives a very long single word", () => {
    const out = toPdfSafe("A".repeat(50_000));
    expect(out.length).toBeLessThanOrEqual(PDF_MAX_LABEL);
  });
});

describe("toPdfSafe: keeps what can be read", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(toPdfSafe("Honda Civic 2019")).toBe("Honda Civic 2019");
  });

  it("strips Latin diacritics rather than dropping the letter", () => {
    expect(toPdfSafe("Génératrice Économique")).toBe("Generatrice Economique");
    expect(toPdfSafe("Kübel")).toBe("Kubel");
  });

  it("transliterates letters that have no decomposition", () => {
    // "ł" survives NFD untouched, so it needs the explicit map.
    expect(toPdfSafe("Gdańsk Łódź")).toBe("Gdansk Lodz");
  });

  it("expands ligatures", () => {
    expect(toPdfSafe("ﬁnal")).toBe("final");
  });

  it("keeps letters that WinAnsi can encode", () => {
    // These are CP1252 code points, so they must survive rather than become "?".
    expect(toPdfSafe("Café “quoted” — dash…")).toContain("quoted");
    expect(toPdfSafe("naïve")).toBe("naive");
  });

  it("substitutes currency symbols it cannot encode", () => {
    // The reason money in the document is an ISO code rather than a symbol.
    expect(toPdfSafe("₹1,234")).toBe("INR 1,234");
    expect(toPdfSafe("₱500")).toBe("PHP 500");
    expect(toPdfSafe("₪900")).toBe("ILS 900");
  });

  it("replaces unencodable scripts with a marker instead of throwing", () => {
    expect(toPdfSafe("车位")).toBe("??");
    // One marker per code point: "سيارة" is five characters.
    expect(toPdfSafe("سيارة")).toBe("?????");
    expect(toPdfSafe("car 🚗")).toContain("car");
    expect(toPdfSafe("car 🚗")).toContain("?");
  });

  it("flattens whitespace so a multi-line value cannot move the cursor", () => {
    expect(toPdfSafe("line one\nline two\tend")).toBe("line one line two end");
    expect(toPdfSafe("  padded  ")).toBe("padded");
  });

  it("drops control characters", () => {
    expect(toPdfSafe("a\u0000b\u0007c")).toBe("abc");
  });

  it("keeps a bidirectional mark from reordering the text", () => {
    // U+202E is not encodable; it must not survive into the document, where it
    // would visually reverse the following characters.
    expect(toPdfSafe("abc\u202edef")).not.toContain("\u202e");
  });

  it("caps the length", () => {
    const out = toPdfSafe("x".repeat(400));
    expect(out.length).toBeLessThanOrEqual(PDF_MAX_LABEL);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("pdfFilenameStem", () => {
  it("keeps only filename-safe characters", () => {
    expect(pdfFilenameStem("Gdańsk Łódź")).toBe("gdansk-lodz");
  });

  it("cannot escape the download directory", () => {
    const stem = pdfFilenameStem("../../etc/passwd");
    expect(stem).not.toContain("/");
    expect(stem).not.toContain("..");
    expect(stem).toMatch(/^[a-z0-9-]+$/);
  });

  it("cannot inject a header", () => {
    const stem = pdfFilenameStem('a"; rm -rf / #');
    expect(stem).toMatch(/^[a-z0-9-]+$/);
  });

  it("falls back when nothing usable remains", () => {
    expect(pdfFilenameStem("车位")).toBe("vehicle");
    expect(pdfFilenameStem("")).toBe("vehicle");
  });

  it("caps the length", () => {
    expect(pdfFilenameStem("a".repeat(500)).length).toBeLessThanOrEqual(60);
  });
});

describe("pdfMoney", () => {
  it("appends the ISO code instead of a symbol", () => {
    // "$" alone does not say USD, CAD, AUD, MXN or ARS.
    expect(pdfMoney(123450, "USD")).toBe("1,234.50 USD");
  });

  it("does not leak a symbol that WinAnsi cannot encode", () => {
    for (const c of ["INR", "PHP", "ILS", "NGN", "TRY"]) {
      expect(pdfMoney(99999, c)).toBe(`999.99 ${c}`);
    }
  });

  it("agrees with the existing formatter across supported currencies", () => {
    // The PDF reuses formatMoney for the digits, so the decimal handling has
    // to be identical to the page: this app stores every currency in cents.
    for (const c of ["USD", "EUR", "GBP", "INR", "PHP", "ILS", "NGN", "TRY", "BRL"]) {
      expect(pdfMoney(123450, c)).toBe(`1,234.50 ${c}`);
      expect(pdfMoney(5, c)).toBe(`0.05 ${c}`);
    }
  });

  it("labels the code consistently with the digits for an unsupported currency", () => {
    // formatMoney falls back to USD, so the code must fall back with it rather
    // than printing USD figures under a currency label they are not in.
    expect(pdfMoney(123450, "JPY")).toBe("1,234.50 USD");
    expect(pdfMoney(123450, "XYZ")).toBe("1,234.50 USD");
  });

  it("handles zero and negatives", () => {
    expect(pdfMoney(0, "EUR")).toBe("0.00 EUR");
    expect(pdfMoney(-5000, "EUR")).toBe("-50.00 EUR");
  });
});

describe("wrapText", () => {
  const width = 50;

  it("returns nothing for an empty string", () => {
    expect(wrapText("", stubFont, 10, width)).toEqual([]);
  });

  it("keeps every word", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", stubFont, 10, width);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("never returns a line wider than the column", () => {
    const lines = wrapText(
      "insurance renewal tyres fuel servicing and a very long note about the invoice total",
      stubFont,
      9,
      width
    );
    for (const line of lines) {
      expect(stubFont.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(mm(width));
    }
  });

  it("hard-breaks a single word that is wider than the column", () => {
    // Dropping the overflow would lose text from a document somebody may file.
    const lines = wrapText("V".repeat(200), stubFont, 10, width);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("V".repeat(200));
  });

  it("does not loop forever on a long note", () => {
    const lines = wrapText("word ".repeat(2000), stubFont, 9, width);
    expect(lines.length).toBeGreaterThan(50);
    expect(lines.length).toBeLessThan(5000);
  });
});

describe("ellipsize", () => {
  it("leaves a short string alone", () => {
    expect(ellipsize("short", stubFont, 10, 100)).toBe("short");
  });

  it("marks a cut string and respects the width", () => {
    const out = ellipsize("A".repeat(300), stubFont, 10, 40);
    expect(out.endsWith("...")).toBe(true);
    expect(stubFont.widthOfTextAtSize(out, 10)).toBeLessThanOrEqual(mm(40));
  });
});

describe("layoutTable", () => {
  const columns = [
    { header: "Category", widthMm: 80, align: "left" as const },
    { header: "Amount", widthMm: 94, align: "right" as const },
  ];
  const bottomY = PAGE.footerReserveMm + 6;

  it("puts the caption and header on the first page", () => {
    const r = layoutTable(
      { columns, caption: "By category", rows: [{ cells: ["fuel", "10.00 USD"] }] },
      stubFont,
      stubFont,
      contentBox().heightMm + PAGE.marginMm,
      bottomY
    );
    expect(r.lines[0].text).toBe("By category");
    expect(r.pages).toBe(1);
  });

  it("paginates instead of drawing past the footer", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      cells: [`expense ${i}`, `${i}.00 USD`],
    }));
    const r = layoutTable({ columns, rows }, stubFont, stubFont, 200, bottomY);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.lines.filter((l) => l.pageBreak).length).toBe(r.pages - 1);
    for (const line of r.lines) {
      expect(line.yMm).toBeGreaterThan(bottomY);
      expect(line.xMm).toBeGreaterThanOrEqual(PAGE.marginMm - 0.001);
    }
  });

  it("keeps a right-aligned column inside its own width", () => {
    const r = layoutTable(
      { columns, rows: [{ cells: ["fuel", "1,234,567.89 EUR"] }] },
      stubFont,
      stubFont,
      200,
      bottomY
    );
    const amount = r.lines.find((l) => l.text.includes("EUR"))!;
    const rightEdge = amount.xMm + mm(stubFont.widthOfTextAtSize(amount.text, FONT_BODY));
    expect(rightEdge).toBeLessThanOrEqual(PAGE.widthMm - PAGE.marginMm + 0.001);
  });

  it("puts every cell of one row on the same line", () => {
    // Regression guard: emitting one line per *cell* instead of per *row*
    // advances the cursor per column, which stacks the five columns vertically
    // and makes the table unreadable while still "fitting" on the page.
    const r = layoutTable(
      { columns, rows: [{ cells: ["fuel", "10.00 USD"] }, { cells: ["tax", "20.00 USD"] }] },
      stubFont,
      stubFont,
      200,
      bottomY
    );
    const fuel = r.lines.filter((l) => l.text === "fuel" || l.text === "10.00 USD");
    expect(fuel).toHaveLength(2);
    expect(fuel[0].yMm).toBe(fuel[1].yMm);
    // The second row must be one line lower, not one cell lower again.
    const tax = r.lines.filter((l) => l.text === "tax" || l.text === "20.00 USD");
    expect(tax[0].yMm).toBe(fuel[0].yMm - LEADING.row);
  });

  it("advances one line per row, not one per cell", () => {
    // Five columns over 20 rows must occupy 20 row heights, not 100.
    const rows = Array.from({ length: 20 }, (_, i) => ({
      cells: [`c${i}`, `d${i}`, `e${i}`, `f${i}`, `g${i}`],
    }));
    const r = layoutTable(
      {
        columns: [
          { header: "A", widthMm: 30, align: "left" },
          { header: "B", widthMm: 30, align: "left" },
          { header: "C", widthMm: 30, align: "left" },
          { header: "D", widthMm: 30, align: "left" },
          { header: "E", widthMm: 54, align: "left" },
        ],
        rows,
      },
      stubFont,
      stubFont,
      200,
      bottomY
    );
    // 20 rows + 1 header row, one line each.
    expect(r.heightMm).toBeCloseTo(21 * LEADING.row, 5);
  });
});

const FONT_BODY = 9.5;

describe("footer", () => {
  it("carries the required disclaimer and a generation date", () => {
    const [disclaimer, stamp] = footerLines(new Date("2026-10-05T12:00:00Z"));
    expect(disclaimer).toBe(PDF_FOOTER_DISCLAIMER);
    expect(disclaimer).toBe(
      "Estimates based on data you entered. Not financial, tax or valuation advice."
    );
    expect(stamp).toContain("Generated 2026-10-05");
  });
});

describe("allowlist matches the real font encoder", () => {
  it("encodes every sanitized sample with pdf-lib's WinAnsi font", async () => {
    // The guard against pdf-safe.ts drifting from pdf-lib: if a character is
    // wrongly listed as encodable, drawText will throw here, in CI, instead of
    // in a user's browser.
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const samples = [
      "plain ascii",
      "éèêëàâçôû",
      "Gdańsk Łódź",
      "ħıŋŧĸəæÆœŒßøØþÞðÐ",
      "ﬁﬂﬀﬃﬄ",
      "naïve “quoted” ‘single’ — dash – ellipsis…",
      "©®™°±×÷¢½¼¾",
      "€£¥₹₱₪₦₺₩฿",
      "٠١٢٣٤٥٦٧٨٩",
      "اَلْعَرَبِيَّة",
      "车位报告",
      "日本語のレポート",
      "emoji 🚗🔥💨",
      "mixture: Gdańsk 车 🚗 ₹",
    ];

    for (const sample of samples) {
      const safe = toPdfSafe(sample);
      expect(() => font.widthOfTextAtSize(safe, 10)).not.toThrow();
      expect(() => font.encodeText(safe)).not.toThrow();
    }
  });
});
