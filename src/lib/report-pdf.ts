/**
 * PDF rendering for the ownership-cost report.
 *
 * `pdf-lib` is imported dynamically *inside* the render function. The route
 * handler that calls this is the only importer, so the library stays out of
 * every other server bundle and out of all client bundles, and its ~500 KB of
 * parse cost is only paid when somebody actually asks for a PDF.
 *
 * The numbers in this document are produced entirely by the existing
 * computations (`summarizeExpenses`, `computeDepreciation`, `projectCost`,
 * `trueOwnershipCost`). Nothing here computes a financial figure: it only
 * formats and places values that were already calculated.
 */
import { formatMoney } from "./finance";
import { isSupportedCurrency } from "./currency";
import type {
  CostSummary,
  DepreciationResult,
  Forecast,
  CostInputs,
  trueOwnershipCost,
} from "./finance";
import { toPdfSafe } from "./pdf-safe";
import {
  PAGE,
  FONT,
  LEADING,
  mm,
  wrapText,
  ellipsize,
  layoutTable,
  footerLines,
  type Column,
  type TextRow,
} from "./report-pdf-layout";

/**
 * Money as an ISO code: "1,234.50 INR".
 *
 * `formatMoney()` is reused for the digits so each currency keeps its correct
 * number of minor units (JPY has none, most have two), then the symbol is
 * dropped in favour of the code. Two reasons: WinAnsi cannot encode several of
 * the symbols Intl produces (INR, PHP, ILS), and `$` alone does not say whether
 * a figure is USD, CAD, AUD, MXN or ARS.
 */
export function pdfMoney(cents: number, currency: string): string {
  const formatted = formatMoney(cents, currency);
  const digits = formatted
    // Keep digits, separators and the sign; drop every currency symbol/letter.
    .replace(/[^\d.,\-\u00a0\u202f\s]/g, "")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
  // The code has to agree with the digits. `formatMoney` substitutes USD for a
  // currency it does not support, so printing the requested code here would
  // label those USD figures with the wrong currency.
  const code = isSupportedCurrency(currency) ? currency.toUpperCase() : "USD";
  return `${digits} ${code}`;
}

/** Plain number formatting, also via the existing Intl path. */
function pdfNumber(value: number, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return value.toFixed(fractionDigits);
  }
}

/** One expense line as it will be listed. Already-computed values only. */
export interface ExpenseLine {
  date: Date;
  category: string;
  merchant: string | null;
  notes: string | null;
  mileage: number | null;
  mileageUnit: string | null;
  amountCents: number;
  currency: string;
}

export interface OwnershipReportData {
  /** Untrusted: every field below is passed through toPdfSafe. */
  vehicle: {
    nickname: string | null;
    brand: string;
    model: string;
    year: number;
    mileageUnit: string;
  };
  accountEmail: string;
  summary: CostSummary;
  forecast12: Forecast;
  depreciation: DepreciationResult | null;
  trueCost: ReturnType<typeof trueOwnershipCost> | null;
  trueCostInputs: CostInputs | null;
  /** Individual entries, newest first. No arithmetic is applied to them. */
  expenses: ExpenseLine[];
  /** How many entries exist in total, so a capped list can say so. */
  totalExpenseCount: number;
  generatedAt: Date;
}

/** A4 at the 72dpi PDF user-space unit. */
const PAGE_SIZE: [number, number] = [mm(PAGE.widthMm), mm(PAGE.heightMm)];

export async function renderOwnershipCostPdf(data: OwnershipReportData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = PAGE.marginMm;
  const right = PAGE.widthMm - PAGE.marginMm;
  const topY = PAGE.heightMm - PAGE.marginMm;
  // Content must stop above the footer band.
  const bottomY = PAGE.footerReserveMm + 6;
  const fullWidth = PAGE.widthMm - PAGE.marginMm * 2;

  let page = doc.addPage(PAGE_SIZE);
  let y = topY - 4;

  /** Create a fresh page and reset the cursor to the top of the body area. */
  const newPage = () => {
    page = doc.addPage(PAGE_SIZE);
    y = PAGE.heightMm - PAGE.marginMm - 14;
  };

  /** Reserve vertical space, breaking the page if it would not fit. */
  const ensure = (heightMm: number) => {
    if (y - heightMm < bottomY) newPage();
  };

  const draw = (
    text: string,
    xMm: number,
    sizePt: number,
    opts: { bold?: boolean; colour?: [number, number, number]; maxWidthMm?: number } = {}
  ) => {
    const font = opts.bold ? bold : body;
    const drawn =
      opts.maxWidthMm !== undefined
        ? ellipsize(text, font, sizePt, opts.maxWidthMm)
        : text;
    page.drawText(drawn, {
      x: mm(xMm),
      y: mm(y),
      size: sizePt,
      font,
      color: rgb(...(opts.colour ?? [0.08, 0.09, 0.11])),
    });
  };

  /** A wrapped paragraph. Returns the height it consumed. */
  const paragraph = (
    text: string,
    opts: { sizePt?: number; bold?: boolean; indentMm?: number; leading?: number; colour?: [number, number, number] } = {}
  ): number => {
    const sizePt = opts.sizePt ?? FONT.smallPt;
    const leading = opts.leading ?? LEADING.small;
    const indent = opts.indentMm ?? 0;
    const lines = wrapText(text, font_(opts.bold), sizePt, fullWidth - indent);
    for (const line of lines) {
      ensure(leading);
      draw(line, left + indent, sizePt, { bold: opts.bold, colour: opts.colour });
      y -= leading;
    }
    return lines.length * leading;
  };

  /** Layout a table and draw it, breaking pages as needed. */
  const table = (columns: Column[], rows: TextRow[], caption?: string): void => {
    const laid = layoutTable({ columns, rows, caption }, body, bold, y, bottomY);
    for (const line of laid.lines) {
      if (line.pageBreak) newPage();
      page.drawText(line.text, {
        x: mm(line.xMm),
        y: mm(line.yMm),
        size: line.sizePt,
        font: line.bold ? bold : body,
        color: rgb(0.08, 0.09, 0.11),
      });
      if (line.ruleAfter) {
        page.drawLine({
          start: { x: mm(left), y: mm(line.yMm - 1.8) },
          end: { x: mm(right), y: mm(line.yMm - 1.8) },
          thickness: 0.5,
          color: rgb(0.75, 0.76, 0.78),
        });
      }
    }
    y -= laid.heightMm + 3;
  };

  function font_(isBold?: boolean) {
    return isBold ? bold : body;
  }

  const grey: [number, number, number] = [0.42, 0.44, 0.47];
  const accent: [number, number, number] = [0.05, 0.35, 0.25];

  const { summary, vehicle } = data;
  const currency = summary.baseCurrency;
  const unit = toPdfSafe(vehicle.mileageUnit) || "km";

  // ---- Title block -------------------------------------------------------
  ensure(20);
  draw(toPdfSafe("Ownership cost report"), left, FONT.titlePt, { bold: true });
  y -= 6;

  const vehicleLine = toPdfSafe(
    [vehicle.year, vehicle.brand, vehicle.model].filter(Boolean).join(" ")
  );
  const nameLine = toPdfSafe(vehicle.nickname ?? "");
  paragraph(nameLine ? `${vehicleLine} - ${nameLine}` : vehicleLine, {
    sizePt: FONT.bodyPt,
    colour: grey,
  });
  paragraph(toPdfSafe(data.accountEmail), { sizePt: FONT.smallPt, colour: grey, leading: 3.2 });
  y -= 2;

  // ---- Summary -----------------------------------------------------------
  ensure(10);
  draw(toPdfSafe("Summary"), left, FONT.headingPt, { bold: true });
  y -= LEADING.heading;

  const distance =
    summary.totalDistance !== null
      ? `${pdfNumber(summary.totalDistance)} ${unit}`
      : "Not recorded";
  const costPerUnit =
    summary.costPerKm !== null ? pdfMoney(summary.costPerKm, currency) : "Not recorded";

  table(
    [
      { header: "Measure", widthMm: 74, align: "left" },
      { header: "Value", widthMm: fullWidth - 74, align: "left" },
    ],
    [
      { cells: ["Months of data", String(summary.monthsOfData)] },
      { cells: ["Total recorded spending (ACTUAL)", pdfMoney(summary.totalSpent, currency)] },
      { cells: [`Distance driven (ACTUAL)`, distance] },
      { cells: ["Monthly average (ACTUAL)", pdfMoney(summary.monthlyAverage, currency)] },
      { cells: ["Estimated annual cost (FORECAST)", pdfMoney(summary.annualEstimate, currency)] },
      { cells: [`Cost per ${unit} (ACTUAL)`, costPerUnit] },
    ]
  );

  // ---- By category -------------------------------------------------------
  if (summary.breakdown.length > 0) {
    table(
      [
        { header: "Category", widthMm: 78, align: "left" },
        { header: "Amount", widthMm: fullWidth - 108, align: "right" },
        { header: "%", widthMm: 30, align: "right" },
      ],
      summary.breakdown.map((b) => ({
        cells: [toPdfSafe(b.category), pdfMoney(b.amount, currency), `${pdfNumber(b.percent)}%`],
      })),
      "By category"
    );
  }

  // ---- Expense detail ----------------------------------------------------
  // The aggregate above cannot show what the money was actually spent on, and a
  // vehicle with hundreds of entries is exactly the case where the reader wants
  // the list. These are the recorded rows, verbatim: no grouping, no re-totalling.
  if (data.expenses.length > 0) {
    const listed = data.expenses;
    const omitted = data.totalExpenseCount - listed.length;

    table(
      [
        { header: "Date", widthMm: 24, align: "left" },
        { header: "Category", widthMm: 32, align: "left" },
        { header: "Merchant", widthMm: 54, align: "left" },
        { header: unit === "mi" ? "Miles" : "km", widthMm: 20, align: "right" },
        { header: "Amount", widthMm: fullWidth - 130, align: "right" },
      ],
      listed.map((e) => ({
        cells: [
          e.date.toISOString().slice(0, 10),
          toPdfSafe(e.category),
          // Prefer the note when there is no merchant, but never concatenate
          // both: the column is narrow and the note is the more specific field.
          toPdfSafe(e.merchant ?? e.notes ?? "-"),
          e.mileage === null ? "-" : pdfNumber(e.mileage),
          pdfMoney(e.amountCents, e.currency),
        ],
      })),
      `Expenses (${pdfNumber(listed.length)} of ${pdfNumber(data.totalExpenseCount)})`
    );

    if (omitted > 0) {
      // Never truncate silently: a reader has to be able to tell that the list
      // is partial, or they may assume they are looking at everything.
      paragraph(
        `${pdfNumber(omitted)} earlier ${omitted === 1 ? "entry is" : "entries are"} not listed. The totals above include all ${pdfNumber(
          data.totalExpenseCount
        )} entries.`,
        { colour: grey }
      );
    }
  }

  // ---- Forecast ----------------------------------------------------------
  ensure(16);
  draw(toPdfSafe("Forecast, next 12 months"), left, FONT.headingPt, { bold: true });
  y -= LEADING.heading;
  draw(pdfMoney(data.forecast12.total, currency), left, 14, { bold: true, colour: accent });
  y -= 6;
  for (const assumption of data.forecast12.assumptions) {
    paragraph(`- ${toPdfSafe(assumption)}`, { indentMm: 2 });
  }
  y -= 2;

  // ---- Depreciation ------------------------------------------------------
  if (data.depreciation) {
    ensure(16);
    draw(toPdfSafe("Depreciation (ESTIMATE)"), left, FONT.headingPt, { bold: true });
    y -= LEADING.heading;
    paragraph(`Method: ${toPdfSafe(data.depreciation.method)}`, { sizePt: FONT.bodyPt });
    paragraph(
      `Total estimated depreciation: ${pdfMoney(data.depreciation.totalDepreciationCents, currency)}`,
      { sizePt: FONT.bodyPt, bold: true }
    );
    paragraph(toPdfSafe(data.depreciation.note), { colour: grey });
    y -= 2;
  }

  // ---- True cost of ownership -------------------------------------------
  if (data.trueCost) {
    ensure(16);
    draw(
      toPdfSafe("True cost of ownership (3-year horizon)"),
      left,
      FONT.headingPt,
      { bold: true }
    );
    y -= LEADING.heading;
    draw(pdfMoney(data.trueCost.total, currency), left, 14, { bold: true });
    y -= 6;

    table(
      [
        { header: "Component", widthMm: 106, align: "left" },
        { header: "Basis", widthMm: 30, align: "left" },
        { header: "Amount", widthMm: fullWidth - 136, align: "right" },
      ],
      data.trueCost.breakdown.map((b) => ({
        cells: [
          toPdfSafe(b.label),
          toPdfSafe(b.source.toUpperCase()),
          pdfMoney(b.cents, currency),
        ],
      }))
    );

    if (data.trueCostInputs) {
      const i = data.trueCostInputs;
      const resale =
        i.estimatedResaleCents === null
          ? "not provided"
          : pdfMoney(i.estimatedResaleCents, currency);
      paragraph(
        `Purchase price ${pdfMoney(i.purchasePriceCents, currency)}, purchased ${i.purchaseDate
          .toISOString()
          .slice(0, 10)}, estimated resale ${resale}.`,
        { colour: grey }
      );
    }

    ensure(8);
    draw(toPdfSafe("Assumptions"), left, FONT.labelPt, { bold: true, colour: grey });
    y -= LEADING.small;
    for (const assumption of data.trueCost.assumptions) {
      paragraph(`- ${toPdfSafe(assumption)}`, { indentMm: 2 });
    }
    y -= 2;
  }

  // ---- Standing disclaimer ----------------------------------------------
  ensure(12);
  paragraph(
    "Every figure above is ACTUAL (from data you recorded), ESTIMATE (from a stated assumption) or FORECAST (a projection). AutoEco analyses the data you enter; it does not diagnose a vehicle or tell you what a vehicle or a deduction is worth.",
    { colour: grey }
  );

  // ---- Footer on every page ---------------------------------------------
  const [disclaimer, stamp] = footerLines(data.generatedAt);
  for (const p of doc.getPages()) {
    const pWidth = mm(PAGE.widthMm);
    p.drawLine({
      start: { x: mm(left), y: mm(PAGE.footerReserveMm + 3) },
      end: { x: mm(right), y: mm(PAGE.footerReserveMm + 3) },
      thickness: 0.5,
      color: rgb(0.75, 0.76, 0.78),
    });
    p.drawText(disclaimer, {
      x: mm(left),
      y: mm(PAGE.footerReserveMm - 1),
      size: 6.8,
      font: body,
      color: rgb(0.42, 0.44, 0.47),
    });
    const stampWidth = body.widthOfTextAtSize(stamp, 6.8);
    p.drawText(stamp, {
      x: pWidth - mm(left) - stampWidth,
      y: mm(PAGE.footerReserveMm - 1),
      size: 6.8,
      font: body,
      color: rgb(0.42, 0.44, 0.47),
    });
  }

  return doc.save();
}
