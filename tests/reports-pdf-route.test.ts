/**
 * PDF report: the download route, against a real database.
 *
 * The unit tests in `report-pdf.test.ts` pin the layout and the text safety.
 * This file pins the contract a user's browser actually depends on:
 *
 *   - a free account gets a refusal with a stable machine-readable code,
 *   - one account can never download another account's vehicle,
 *   - a Pro account gets a real PDF that parses,
 *   - and a PDF whose every string is unencodable still comes out as a valid
 *     document rather than a 500.
 *
 * Real DB, real route handler, mocked `next/headers` cookie jar (the pattern
 * already used by `auth-hardening.test.ts`), so no HTTP server is involved.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import zlib from "zlib";
import { DB_OK } from "./_dbGuard";
import { ensurePdfReportSchema } from "./_ensureSchema";
import { PDF_FOOTER_DISCLAIMER } from "@/lib/report-pdf-layout";

const prisma = new PrismaClient();
const stamp = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.AUTH_SECRET = "phase34-auth-secret-0123456789abcdef012345";
process.env.NEXT_PUBLIC_APP_URL = "https://autoeco.test";

const run = DB_OK ? it : it.skip;
const runSuite = DB_OK ? describe : describe.skip;

type ReportRoute = typeof import("@/app/api/reports/ownership-cost/route");

/** A plan with the PDF entitlement either on or off. */
async function makePlan(enablePdfReports: boolean) {
  return prisma.plan.create({
    data: {
      key: `p_${stamp}_${enablePdfReports ? "pro" : "free"}_${Math.random().toString(36).slice(2, 6)}`,
      name: enablePdfReports ? "Pro" : "Free",
      priceCents: enablePdfReports ? 900 : 0,
      billingPeriod: enablePdfReports ? "MONTHLY" : "FREE",
      maxVehicles: 5,
      maxExpensesPerMonth: 100000,
      aiReceiptScansPerMonth: 100,
      aiConversationsPerMonth: 100,
      reportRetentionDays: 3650,
      forecastHorizonMonths: 12,
      enableAdvancedScenarios: true,
      enableShareableReports: true,
      enableFamilySharing: false,
      enableApiAccess: false,
      enablePdfReports,
      features: "[]",
    },
  });
}

async function makeUser(enablePdfReports: boolean, opts: { email?: string; currency?: string } = {}) {
  const plan = await makePlan(enablePdfReports);
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `${stamp}-${Math.random().toString(36).slice(2, 8)}@autoeco.app`,
      passwordHash: "x",
      name: "PDF Test",
      role: "USER",
      planId: plan.id,
      currency: opts.currency ?? "USD",
      distanceUnit: "km",
      fuelUnit: "L_PER_100KM",
    },
  });

  // `getEntitlements` resolves the plan through an active Subscription, not
  // through `user.planId`, so the entitlement test has to create one. A paid
  // user without a row would silently fall back to the free defaults and every
  // "Pro can download" assertion would be passing against the wrong plan.
  if (enablePdfReports) {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
      },
    });
  }

  return { user, plan };
}

async function makeVehicle(
  userId: string,
  overrides: Partial<{
    nickname: string | null;
    brand: string;
    model: string;
    year: number;
    purchasePriceCents: number | null;
    estimatedResaleCents: number | null;
    currentMileageUnit: string | null;
  }> = {}
) {
  return prisma.vehicle.create({
    data: {
      userId,
      nickname: overrides.nickname ?? "Daily",
      brand: overrides.brand ?? "Honda",
      model: overrides.model ?? "Civic",
      year: overrides.year ?? 2019,
      purchaseDate: new Date("2019-03-01T00:00:00Z"),
      purchasePriceCents: overrides.purchasePriceCents ?? 1_450_000,
      estimatedResaleCents: overrides.estimatedResaleCents ?? 620_000,
      currentMileageUnit: overrides.currentMileageUnit ?? "km",
    },
  });
}

async function addExpenses(
  userId: string,
  vehicleId: string,
  count: number,
  currency = "USD",
  category = "fuel"
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    userId,
    vehicleId,
    category,
    amountCents: 4_200 + i,
    currency,
    date: new Date(Date.UTC(2024, i % 12, 1 + (i % 28))),
    merchant: "Station",
  }));
  // createMany keeps 200 rows in one statement instead of 200 round trips.
  await prisma.expense.createMany({ data: rows });
}

/**
 * Pull every drawn string out of the document.
 *
 * pdf-lib writes text as hex strings inside Flate-compressed content streams,
 * so this inflates the streams and decodes the hex. It is the only way to
 * assert on what actually ended up on the page rather than on what the layout
 * code intended to put there.
 */
function extractDrawnText(buf: Buffer): { x: number; size: number; bold: boolean; text: string }[] {
  const latin = buf.toString("latin1");
  let content = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      content += zlib.inflateSync(buf.subarray(start, end)).toString("latin1") + "\n";
    } catch {
      /* not a flate stream */
    }
  }

  const drawn: { x: number; size: number; bold: boolean; text: string }[] = [];
  let x = 0;
  let size = 0;
  let bold = false;
  const tokens =
    content.match(
      /\/[A-Za-z0-9-]+\s+[\d.]+\s+Tf|-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+Tm|<[0-9A-Fa-f]*>\s*Tj/g
    ) ?? [];
  for (const tok of tokens) {
    if (tok.endsWith("Tf")) {
      size = parseFloat(tok.match(/([\d.]+)\s+Tf/)![1]);
      bold = /Bold/i.test(tok.match(/\/([A-Za-z0-9-]+)/)![1]);
    } else if (tok.endsWith("Tm")) {
      x = tok.match(/-?[\d.]+/g)!.map(Number)[4];
    } else {
      const hex = tok.slice(1, tok.indexOf(">"));
      let text = "";
      for (let i = 0; i + 1 < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      }
      drawn.push({ x, size, bold, text });
    }
  }
  return drawn;
}

const PAGE_WIDTH_PT = (210 * 72) / 25.4;
const MARGIN_PT = (18 * 72) / 25.4;

runSuite("PDF report download (real DB)", () => {
  let route: ReportRoute;
  let auth: typeof import("@/lib/auth");

  beforeAll(async () => {
    await ensurePdfReportSchema(prisma);
    route = await import("@/app/api/reports/ownership-cost/route");
    auth = await import("@/lib/auth");
  });

  beforeEach(() => {
    jar.clear();
  });

  afterAll(async () => {
    const ids = `(SELECT id FROM "User" WHERE email LIKE '${stamp}-%@autoeco.app')`;
    for (const sql of [
      `DELETE FROM "Expense" WHERE "userId" IN ${ids}`,
      `DELETE FROM "Subscription" WHERE "userId" IN ${ids}`,
      `DELETE FROM "Vehicle" WHERE "userId" IN ${ids}`,
      `DELETE FROM "User" WHERE email LIKE '${stamp}-%@autoeco.app'`,
      `DELETE FROM "Plan" WHERE key LIKE 'p_${stamp}_%'`,
    ]) {
      await prisma.$executeRawUnsafe(sql).catch(() => {});
    }
    await prisma.$disconnect();
  });

  function download(vehicleId: string) {
    return route.GET(
      new Request(`https://autoeco.test/api/reports/ownership-cost?vehicleId=${vehicleId}`),
      undefined
    );
  }

  run("a free account is refused with a stable code", async () => {
    const { user } = await makeUser(false);
    const vehicle = await makeVehicle(user.id);
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("PDF_REPORTS_NOT_INCLUDED");
    // The refusal must not leak whether the vehicle id was real.
    expect(JSON.stringify(body)).not.toContain(vehicle.id);
  });

  run("a Pro account receives a parseable PDF", async () => {
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id);
    await addExpenses(user.id, vehicle.id, 12);
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    // Financial data must not be cached by a proxy or the back/forward cache.
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const bytes = new Uint8Array(await res.arrayBuffer());
    // A PDF always starts with this header; checking the magic number catches a
    // JSON error body returned with a 200.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");

    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);

    // The disclaimer is required on EVERY page, not just the first.
    const drawn = extractDrawnText(Buffer.from(bytes));
    const footers = drawn.filter((d) => d.text.includes(PDF_FOOTER_DISCLAIMER));
    expect(footers).toHaveLength(doc.getPageCount());
    // And a generation date on every page.
    const stamps = drawn.filter((d) => /^Generated \d{4}-\d{2}-\d{2}$/.test(d.text));
    expect(stamps).toHaveLength(doc.getPageCount());
  });

  run("nothing is drawn past the right margin", async () => {
    // The failure mode this catches: a nickname, merchant or note that is
    // wider than its column. The PDF still opens, so nobody would notice
    // except the reader who loses the end of a figure off the page edge.
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id, {
      nickname: "B".repeat(300),
      brand: "Mercedes-Benz",
    });
    await addExpenses(user.id, vehicle.id, 4);
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());

    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const offenders: string[] = [];
    for (const d of extractDrawnText(Buffer.from(bytes))) {
      const font = d.bold ? helvBold : helv;
      const right = d.x + font.widthOfTextAtSize(d.text, d.size);
      if (right > PAGE_WIDTH_PT - MARGIN_PT + 0.5) offenders.push(d.text.slice(0, 40));
    }
    expect(offenders).toEqual([]);
  });

  run("another account's vehicle is never downloadable", async () => {
    const owner = await makeUser(true);
    const victim = await makeVehicle(owner.user.id, { nickname: "Secret Car" });
    const attacker = await makeUser(true);
    await auth.createSession(attacker.user.id);

    const res = await download(victim.id);
    // 403 from assertOwnership, or 404 if the lookup is changed to be scoped.
    // Both are acceptable; leaking the PDF is not.
    expect([403, 404]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain("%PDF-");
    expect(text).not.toContain("Secret Car");
  });

  run("a vehicle that does not exist is a 404", async () => {
    const { user } = await makeUser(true);
    await auth.createSession(user.id);

    const res = await download("no-such-vehicle-id");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("%PDF-");
  });

  run("a missing vehicleId is a 400", async () => {
    const { user } = await makeUser(true);
    await auth.createSession(user.id);

    const res = await route.GET(
      new Request("https://autoeco.test/api/reports/ownership-cost"),
      undefined
    );
    expect(res.status).toBe(400);
  });

  run("mixed currencies are refused instead of summed", async () => {
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id);
    await addExpenses(user.id, vehicle.id, 3, "USD");
    await addExpenses(user.id, vehicle.id, 3, "EUR", "insurance");
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MIXED_CURRENCY");
  });

  run("INR, PHP and ILS produce a valid PDF", async () => {
    // The currencies whose symbols WinAnsi cannot encode. If the document ever
    // went back to symbols, pdf-lib would throw here.
    for (const currency of ["INR", "PHP", "ILS"]) {
      const { user } = await makeUser(true, { currency });
      const vehicle = await makeVehicle(user.id);
      await addExpenses(user.id, vehicle.id, 4, currency);
      await auth.createSession(user.id);

      const res = await download(vehicle.id);
      expect(res.status, `currency ${currency}`).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { PDFDocument } = await import("pdf-lib");
      await expect(PDFDocument.load(bytes), `currency ${currency}`).resolves.toBeTruthy();
    }
  });

  run("a vehicle named in a script the font cannot encode still downloads", async () => {
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id, {
      nickname: "سيارة 车位 🚗 Ćwikł",
      brand: "Łada",
      model: "Niva",
    });
    await addExpenses(user.id, vehicle.id, 5);
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    await expect(PDFDocument.load(bytes)).resolves.toBeTruthy();
  });

  run("the filename cannot escape its directory", async () => {
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id, { nickname: "../../etc/passwd" });
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="autoeco-ownership-cost-[a-z0-9-]+\.pdf"$/);
    expect(disposition).not.toContain("/");
    await res.arrayBuffer();
  });

  run("more than 200 expenses paginate instead of overflowing one page", async () => {
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id, {
      nickname: "x".repeat(400),
    });
    await addExpenses(user.id, vehicle.id, 240, "USD", "maintenance");
    await auth.createSession(user.id);

    const res = await download(vehicle.id);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    // 240 distinct rows cannot fit on a single A4 page.
    expect(doc.getPageCount()).toBeGreaterThan(1);

    // The disclaimer and the generation date have to repeat on all of them.
    const drawn = extractDrawnText(Buffer.from(bytes));
    expect(drawn.filter((d) => d.text.includes(PDF_FOOTER_DISCLAIMER))).toHaveLength(
      doc.getPageCount()
    );
    expect(drawn.filter((d) => /^Generated \d{4}-\d{2}-\d{2}$/.test(d.text))).toHaveLength(
      doc.getPageCount()
    );
  });

  run("the footer disclaimer is a fixed string", async () => {
    // Guards the wording from being reworded by a future edit.
    expect(PDF_FOOTER_DISCLAIMER).toBe(
      "Estimates based on data you entered. Not financial, tax or valuation advice."
    );
  });

  run("an unauthenticated request is not served", async () => {
    jar.clear();
    const { user } = await makeUser(true);
    const vehicle = await makeVehicle(user.id);
    await addExpenses(user.id, vehicle.id, 2);

    const res = await download(vehicle.id);
    expect([401, 403]).toContain(res.status);
    expect(await res.text()).not.toContain("%PDF-");
  });
});
