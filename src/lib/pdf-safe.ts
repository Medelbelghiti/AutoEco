/**
 * Text safety for the PDF renderer.
 *
 * The report is drawn with PDF standard fonts, which are limited to
 * WinAnsiEncoding (roughly CP1252). Anything outside that set makes pdf-lib
 * *throw* while encoding, which would turn one vehicle called "Tokyo" into a
 * 500 for the whole download. So every user-provided string is funnelled
 * through `toPdfSafe()` before it reaches `drawText`.
 *
 * The rule is deliberately lossy and never throws: a report that says "???"
 * is wrong-looking, a report that fails to download is useless.
 */

/** Longest string we will draw for a single label before ellipsizing. */
export const PDF_MAX_LABEL = 160;

/**
 * Exactly the code points pdf-lib's WinAnsiEncoding can encode.
 *
 * Kept as an explicit list rather than a range guess so that a mistake here
 * shows up as a failing test (`report-pdf.test.ts` encodes every sample
 * through the real font) instead of a 500 in production.
 */
const WIN_ANSI = (() => {
  const set = new Set<number>();
  // Printable ASCII. Control characters are deliberately excluded: they are
  // encodable but render as invisible layout damage.
  for (let c = 0x20; c <= 0x7e; c++) set.add(c);
  // CP1252 upper range: punctuation, symbols and the currency/quote marks
  // that Intl emits for most of the supported currencies.
  for (const c of [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
    0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
    0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
  ]) {
    set.add(c);
  }
  // Latin-1 supplement (0xa0-0xff). 0xad (soft hyphen) is included: it is in
  // the encoding, and dropping it would silently join two words.
  for (let c = 0xa0; c <= 0xff; c++) set.add(c);
  return set;
})();

/**
 * Characters that have a sensible ASCII spelling. Applied before the
 * allowlist check because NFD decomposition does not touch them: "ł" has no
 * canonical decomposition, so without this map it would become "?".
 */
const TRANSLITERATE: Record<string, string> = {
  // Latin letters with strokes/slashes that have no decomposition.
  ł: "l", Ł: "L", đ: "d", Đ: "D", ħ: "h", Ħ: "H", ı: "i", İ: "I",
  ŋ: "n", Ŋ: "N", ŧ: "t", Ŧ: "T", ĸ: "k", ə: "e", Ə: "E",
  // Letters that expand rather than replace.
  æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", ß: "ss",
  ø: "o", Ø: "O", þ: "th", Þ: "Th", ð: "d", Ð: "D",
  // Ligatures.
  ﬁ: "fi", ﬂ: "fl", ﬀ: "ff", ﬃ: "ffi", ﬄ: "ffl", ﬅ: "st",
  // Punctuation and symbols that read better than "?".
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
  "…": "...", "×": "x", "÷": "/", "°": " deg",
  "€": "EUR ", "£": "GBP ", "¥": "JPY ", "¢": "c",
  "©": "(c)", "®": "(r)", "™": "(tm)", "½": "1/2", "¼": "1/4", "¾": "3/4",
  // Currency symbols Intl produces that WinAnsi lacks (INR, PHP, ILS, NGN, TRY).
  "₹": "INR ", "₱": "PHP ", "₪": "ILS ", "₦": "NGN ", "₺": "TRY ",
  "₩": "KRW ", "฿": "THB ", "₫": "VND ", "₴": "UAH ", "₡": "CRC ",
  // Arabic-Indic digits render in most Arabic fonts but not in WinAnsi.
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

/** Replaces the longest keys first so "ffi" wins over "f". */
const TRANSLITERATE_KEYS = Object.keys(TRANSLITERATE).sort((a, b) => b.length - a.length);

/**
 * Make a string safe to draw with a WinAnsi standard font.
 *
 * Never throws, for any input including `null`, objects with a hostile
 * `toString`, and lone surrogates. Returns at most `PDF_MAX_LABEL`
 * characters, ellipsized so a pathological input cannot produce one
 * unbreakable line that overflows the page.
 */
export function toPdfSafe(input: unknown): string {
  try {
    if (input === null || input === undefined) return "";

    let text = typeof input === "string" ? input : String(input);

    // 1. Explicit spellings. Done before decomposition so "ﬁ" becomes "fi"
    // rather than being inspected character by character.
    for (const key of TRANSLITERATE_KEYS) {
      if (text.includes(key)) text = text.split(key).join(TRANSLITERATE[key]);
    }

    // 2. Strip diacritics from the Latin ranges we can spell ("é" -> "e").
    //    Characters outside Latin-1 pass through untouched and are filtered by
    //    the allowlist below, which is what we want for CJK/Arabic/emoji.
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 3. Filter against the encoding. Newlines and tabs become spaces so a
    //    multi-line note stays on one line instead of moving the cursor off
    //    the page; every other unencodable character becomes "?".
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0) as number;
      // Whitespace first: \n \r \t are controls too, and they have to become a
      // space so a multi-line note does not join two words together or move the
      // cursor off the page.
      if (ch === "\n" || ch === "\r" || ch === "\t" || code === 0x20 || code === 0xa0) {
        out += " ";
        continue;
      }
      // Any other control is dropped. They are not in the allowlist, so without
      // this they would arrive at the fallback and print as a literal "?".
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
      if (WIN_ANSI.has(code)) {
        out += ch;
        continue;
      }
      // A lone surrogate (from a truncated emoji, say) has no encoding at all.
      if (code >= 0xd800 && code <= 0xdfff) {
        out += "?";
        continue;
      }
      out += "?";
    }

    out = out.replace(/\s+/g, " ").trim();

    if (out.length > PDF_MAX_LABEL) {
      out = out.slice(0, PDF_MAX_LABEL - 3).trimEnd() + "...";
    }
    return out;
  } catch {
    // A stringifier that throws, or anything unforeseen above. The document
    // still has to render.
    return "";
  }
}

/**
 * A filesystem-safe basename for Content-Disposition.
 *
 * Restricted to `[a-z0-9-]` plus the extension, so a nickname like
 * `../../etc/passwd` or `a"; rm -rf /` cannot influence the header. The
 * vehicle's own name is not needed here: the route identifies the vehicle by
 * id, so an unrecognisable name simply falls back to a generic stem.
 */
export function pdfFilenameStem(input: unknown): string {
  const safe = toPdfSafe(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return safe.length > 0 ? safe : "vehicle";
}
