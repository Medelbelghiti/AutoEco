import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/utils";
import { auditLog } from "@/lib/audit";
import { computeVehicleCost } from "@/lib/compute-cost";
import { computeDepreciation, projectCost, trueOwnershipCost } from "@/lib/finance";
import { renderOwnershipCostPdf } from "@/lib/report-pdf";
import { pdfFilenameStem } from "@/lib/pdf-safe";

/**
 * GET /api/reports/ownership-cost?vehicleId=...
 *
 * A PDF of the ownership-cost report for one of the caller's own vehicles.
 * Mirrors the CSV export: a raw `Response` rather than `ok()`, because `ok()`
 * is JSON-only.
 */

const Query = z.object({ vehicleId: z.string().min(1) });

/** Same horizon the on-screen report uses. */
const HORIZON_MONTHS = 36;

export const GET = withErrorHandling(async (req) => {
  const user = await requireUser();

  // Rate limit per user, before any database work: rendering a PDF is the most
  // expensive thing this app does on request.
  const rl = await checkRateLimit({
    key: `report-pdf:${user.id}`,
    limit: 20,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return new Response("Too many report downloads. Please try again later.", {
      status: 429,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)),
      },
    });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({ vehicleId: url.searchParams.get("vehicleId") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Entitlement. Checked before the vehicle lookup so a free user cannot use
  // this endpoint to probe which vehicle ids exist.
  const ent = await getEntitlements(user);
  if (!ent.enablePdfReports) {
    return NextResponse.json(
      {
        error: "PDF reports are not included in your plan.",
        code: "PDF_REPORTS_NOT_INCLUDED",
      },
      { status: 403 }
    );
  }

  const vehicle = await db.vehicle.findUnique({
    where: { id: parsed.data.vehicleId },
    select: {
      id: true, userId: true, nickname: true, brand: true, model: true,
      year: true, currentMileageUnit: true, purchasePriceCents: true,
      purchaseDate: true, estimatedResaleCents: true,
    },
  });
  if (!vehicle) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(vehicle.userId, user);

  const result = await computeVehicleCost(user.id, vehicle.id);
  if (!result.ok) {
    // Same refusal as the page: never sum across currencies.
    return NextResponse.json(
      {
        error:
          "This vehicle has entries in more than one currency, which cannot be added together. Edit them to use a single currency.",
        code: "MIXED_CURRENCY",
        currencies: Array.from(new Set(result.currencies)),
      },
      { status: 422 }
    );
  }

  const summary = result.summary;
  const purchasePriceCents = vehicle.purchasePriceCents;
  const purchaseDate = vehicle.purchaseDate ?? new Date();
  const estimatedResaleCents = vehicle.estimatedResaleCents;
  const generatedAt = new Date();

  // Identical inputs to the on-screen report. No arithmetic is repeated here.
  // A purchase date in the future makes computeDepreciation throw, which would
  // turn a data problem into a 500 on download; the page has the same exposure,
  // but here it is cheaper to omit the section than to fail the document.
  const canDepreciate = purchasePriceCents != null && purchasePriceCents > 0 && purchaseDate <= generatedAt;

  const depreciation = canDepreciate
    ? computeDepreciation({
        purchasePriceCents: purchasePriceCents as number,
        purchaseDate,
        currentResaleCents: estimatedResaleCents,
      })
    : null;
  const trueCostInputs = canDepreciate
    ? {
        purchasePriceCents: purchasePriceCents as number,
        purchaseDate,
        estimatedResaleCents,
        forwardLookingFixedCents: 0,
      }
    : null;

  let bytes: Uint8Array;
  try {
    // The aggregate summary cannot show what the money was spent on. The rows
    // are listed verbatim; only the list is capped, and the cap is printed in
    // the document so a partial list is never mistaken for a complete one.
    const MAX_LISTED = 300;
    const [expenseRows, totalExpenseCount] = await Promise.all([
      db.expense.findMany({
        where: { vehicleId: vehicle.id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: MAX_LISTED,
        select: {
          date: true,
          category: true,
          merchant: true,
          notes: true,
          mileage: true,
          mileageUnit: true,
          amountCents: true,
          currency: true,
        },
      }),
      db.expense.count({ where: { vehicleId: vehicle.id } }),
    ]);

    bytes = await renderOwnershipCostPdf({
      vehicle: {
        nickname: vehicle.nickname,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        mileageUnit: vehicle.currentMileageUnit ?? "km",
      },
      accountEmail: user.email,
      summary,
      forecast12: projectCost(summary, 12),
      depreciation,
      trueCost: trueCostInputs ? trueOwnershipCost(summary, trueCostInputs, HORIZON_MONTHS) : null,
      trueCostInputs,
      expenses: expenseRows,
      totalExpenseCount,
      generatedAt,
    });
  } catch (e) {
    // Rendered entirely in-process: never leak a pdf-lib message or a stack to
    // the client, and record enough to reproduce it from the platform log.
    await auditLog({
      userId: user.id,
      action: "api.error",
      metadata: { route: "reports/ownership-cost", reason: "pdf_render_failed" },
      ip: getClientIp(req),
    }).catch(() => {});
    throw e;
  }

  const stem = pdfFilenameStem(vehicle.nickname ?? `${vehicle.brand}-${vehicle.model}`);
  const filename = `autoeco-ownership-cost-${stem}.pdf`;

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      // Financial data: never cached by a proxy or the browser back/forward cache.
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // A PDF is not an origin-embeddable document.
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
});
