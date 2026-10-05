/**
 * Layout engine for the PDF report.
 *
 * Deliberately knows nothing about pdf-lib: it works in millimetres against a
 * `PdfFontLike`, so wrapping and pagination can be unit-tested without loading
 * a font, and the drawing layer stays a thin shell around it.
 *
 * Millimetres rather than PDF points on purpose: A4 becomes 210x297, which is
 * the unit the constants below are readable in, and `mm()` converts once at
 * the page-creation boundary.
 */

/** The subset of a pdf-lib font this module needs. */
export interface PdfFontLike {
  widthOfTextAtSize(text: string, size: number): number;
}

export const PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 18,
  /** Where the footer band starts; content must never go below this. */
  footerReserveMm: 20,
} as const;

export const FONT = {
  bodyPt: 9.5,
  smallPt: 7.5,
  titlePt: 17,
  headingPt: 11.5,
  labelPt: 8,
} as const;

export const LEADING = {
  body: 4.4,
  small: 3.4,
  heading: 6,
  row: 5.2,
} as const;

export function mm(value: number): number {
  return (value * 72) / 25.4;
}

export interface ContentBox {
  widthMm: number;
  heightMm: number;
}

/** The area left for content once margins and the footer band are removed. */
export function contentBox(): ContentBox {
  return {
    widthMm: PAGE.widthMm - PAGE.marginMm * 2,
    // 14mm of headroom at the top for the document title block.
    heightMm: PAGE.heightMm - PAGE.marginMm * 2 - 14 - PAGE.footerReserveMm,
  };
}

/**
 * Break `text` into lines no wider than `maxWidthMm`.
 *
 * Splits on spaces when it can, and breaks mid-word when a single word is
 * wider than the column (a long VIN or a URL in a note), because dropping the
 * overflow would silently lose text from a document somebody may file.
 */
export function wrapText(
  text: string,
  font: PdfFontLike,
  sizePt: number,
  maxWidthMm: number
): string[] {
  const maxWidth = mm(maxWidthMm);
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return [];

  const lines: string[] = [];
  for (const paragraph of clean.split("\n")) {
    if (paragraph.trim() === "") continue;
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, sizePt) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      // A single word wider than the column: hard-break it.
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, sizePt) > maxWidth && chunk !== "") {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    }
    if (current !== "") lines.push(current);
  }
  return lines;
}

/** `text` shortened to fit one line, ending with an ellipsis when cut. */
export function ellipsize(
  text: string,
  font: PdfFontLike,
  sizePt: number,
  maxWidthMm: number
): string {
  const maxWidth = mm(maxWidthMm);
  if (font.widthOfTextAtSize(text, sizePt) <= maxWidth) return text;
  const dots = "...";
  let out = "";
  for (const ch of text) {
    if (font.widthOfTextAtSize(out + ch + dots, sizePt) > maxWidth) break;
    out += ch;
  }
  return out.trimEnd() + dots;
}

/** A column in a table: how wide, and which way the text sits. */
export interface Column {
  header: string;
  widthMm: number;
  align: "left" | "right";
}

export interface TextRow {
  /** First cell is treated as the row label. */
  cells: string[];
  bold?: boolean;
}

export interface TableSpec {
  columns: Column[];
  rows: TextRow[];
  /** Printed above the table. */
  caption?: string;
}

/** One measured, drawable line. Produced by `layoutTable`. */
export interface LaidOutLine {
  text: string;
  xMm: number;
  yMm: number;
  sizePt: number;
  bold: boolean;
  /** Rule to draw under this line. */
  ruleAfter?: boolean;
}

export interface LaidOutTable {
  lines: LaidOutLine[];
  heightMm: number;
}

/**
 * Measure a table without drawing it, starting at `startYMm` and paging
 * whenever the next line would cross `bottomYMm`.
 *
 * Returns lines with absolute page-relative Y coordinates plus a `pageBreak`
 * marker on the first line of each new page, so the drawing pass can create
 * pages in order.
 */
export function layoutTable(
  spec: TableSpec,
  bodyFont: PdfFontLike,
  boldFont: PdfFontLike,
  startYMm: number,
  bottomYMm: number
): { lines: Array<LaidOutLine & { pageBreak?: boolean }>; heightMm: number; pages: number } {
  const leftMm = PAGE.marginMm;
  const lines: Array<LaidOutLine & { pageBreak?: boolean }> = [];
  const topOfBodyMm = PAGE.heightMm - PAGE.marginMm - 14;
  let y = startYMm;
  let page = 0;
  let lastPage = 0;
  let used = 0;
  const step = LEADING.row;
  const PAD = 1.5;

  function colStart(i: number): number {
    let sum = 0;
    for (let k = 0; k < i; k++) sum += spec.columns[k].widthMm;
    return sum;
  }

  /** Break the page if `heightMm` no longer fits below the cursor. */
  function reserve(heightMm: number): boolean {
    // +1mm slack so a row that exactly fills the remaining space still fits.
    if (y - heightMm >= bottomYMm + 1) return false;
    page += 1;
    y = topOfBodyMm;
    return true;
  }

  /**
   * Emit one logical row. Every cell of the row shares a single Y, so the
   * columns line up; only the row advances the cursor.
   */
  const emitRow = (cells: string[], sizePt: number, bold: boolean, ruleAfter?: boolean) => {
    reserve(step);
    const rowY = y;
    const isNewPage = page > lastPage;
    lastPage = page;
    const font = bold ? boldFont : bodyFont;

    spec.columns.forEach((col, i) => {
      const text = ellipsize(cells[i] ?? "", font, sizePt, col.widthMm - PAD * 2);
      const width = mm(font.widthOfTextAtSize(text, sizePt));
      const x =
        col.align === "right"
          ? leftMm + colStart(i) + col.widthMm - PAD - width
          : leftMm + colStart(i) + PAD;
      lines.push({
        text,
        xMm: x,
        yMm: rowY,
        sizePt,
        bold,
        ...(i === spec.columns.length - 1 && ruleAfter ? { ruleAfter: true } : {}),
        ...(isNewPage && i === 0 ? { pageBreak: true } : {}),
      });
    });

    y -= step;
    used += step;
  };

  if (spec.caption) {
    // The caption is a heading in its own right, so it gets its own leading.
    reserve(LEADING.heading);
    lines.push({
      text: spec.caption,
      xMm: leftMm,
      yMm: y,
      sizePt: FONT.headingPt,
      bold: true,
      ...(page > lastPage ? { pageBreak: true } : {}),
    });
    lastPage = page;
    y -= LEADING.heading;
    used += LEADING.heading;
  }

  emitRow(
    spec.columns.map((c) => c.header),
    FONT.labelPt,
    true,
    true
  );

  for (const row of spec.rows) {
    emitRow(row.cells, FONT.bodyPt, row.bold === true);
  }

  return { lines, heightMm: used, pages: page + 1 };
}

/** The disclaimer printed at the bottom of every page. */
export const PDF_FOOTER_DISCLAIMER =
  "Estimates based on data you entered. Not financial, tax or valuation advice.";

/** Fixed-width footer, centred, so it never collides with the page number. */
export const PDF_FOOTER_PREFIX = "AutoEco - ";

export function footerLines(generatedAt: Date): [string, string] {
  return [PDF_FOOTER_DISCLAIMER, `Generated ${generatedAt.toISOString().slice(0, 10)}`];
}
