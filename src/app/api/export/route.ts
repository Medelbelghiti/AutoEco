import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { withErrorHandling } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvCell, getClientIp } from "@/lib/utils";
import { tripCsvSection } from "@/lib/trips";

/**
 * GET /api/export?dataset=all|vehicles|fuel|expenses|trips
 *
 * Lets a user download everything they have entered as CSV. This backs the
 * "export your data any time" promise, so it must stay dependency-free and
 * must never include another user's rows.
 */

type Dataset = "all" | "vehicles" | "fuel" | "expenses" | "trips";

const DATASETS: Dataset[] = ["all", "vehicles", "fuel", "expenses", "trips"];

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : "";
}

function section(title: string, columns: string[], rows: unknown[][]): string {
  const out = [`# ${title}`, columns.join(",")];
  for (const row of rows) out.push(row.map(csvCell).join(","));
  return out.join("\n");
}

export const GET = withErrorHandling(async (req) => {
  const user = await requireUser();

  const ip = getClientIp(req);
  const rl = await checkRateLimit({ key: `export:${user.id}`, limit: 10, windowSeconds: 3600 });
  if (!rl.allowed) {
    return new Response("Too many export requests. Please try again later.", {
      status: 429,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) },
    });
  }

  const url = new URL(req.url);
  const requested = url.searchParams.get("dataset") ?? "all";
  const dataset: Dataset = (DATASETS as string[]).includes(requested) ? (requested as Dataset) : "all";

  const sections: string[] = [];
  let rowCount = 0;

  if (dataset === "all" || dataset === "vehicles") {
    const vehicles = await db.vehicle.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    rowCount += vehicles.length;
    sections.push(
      section(
        "Vehicles",
        [
          "id", "nickname", "brand", "model", "trim", "generation", "year", "fuelType",
          "transmission", "drivetrain", "purchaseDate", "purchasePriceCents", "purchaseCurrency",
          "currentMileage", "currentMileageUnit", "estimatedResaleCents", "estimatedResaleCurrency",
          "isPrimary", "archived", "isDemo", "notes", "createdAt",
        ],
        vehicles.map((v) => [
          v.id, v.nickname, v.brand, v.model, v.trim, v.generation, v.year, v.fuelType,
          v.transmission, v.drivetrain, iso(v.purchaseDate), v.purchasePriceCents, v.purchaseCurrency,
          v.currentMileage, v.currentMileageUnit, v.estimatedResaleCents, v.estimatedResaleCurrency,
          v.isPrimary, v.archived, v.isDemo, v.notes, iso(v.createdAt),
        ])
      )
    );
  }

  if (dataset === "all" || dataset === "expenses") {
    const expenses = await db.expense.findMany({
      where: { userId: user.id },
      orderBy: { date: "asc" },
      include: { vehicle: { select: { brand: true, model: true, year: true } } },
    });
    rowCount += expenses.length;
    sections.push(
      section(
        "Expenses",
        [
          "id", "date", "vehicle", "category", "amountCents", "currency", "merchant",
          "mileage", "mileageUnit", "recurring", "source", "aiConfidence", "isDemo", "notes", "receiptUrl",
        ],
        expenses.map((e) => [
          e.id, iso(e.date), [e.vehicle.year, e.vehicle.brand, e.vehicle.model].filter(Boolean).join(" "),
          e.category, e.amountCents, e.currency, e.merchant, e.mileage, e.mileageUnit,
          e.recurring, e.source, e.aiConfidence, e.isDemo, e.notes, e.receiptUrl,
        ])
      )
    );
  }

  if (dataset === "all" || dataset === "fuel") {
    const fuel = await db.fuelEntry.findMany({
      where: { userId: user.id },
      orderBy: { date: "asc" },
      include: { vehicle: { select: { brand: true, model: true, year: true } } },
    });
    rowCount += fuel.length;
    sections.push(
      section(
        "Fuel entries",
        [
          "id", "date", "vehicle", "amountCents", "currency", "liters", "kwh", "pricePerUnit",
          "mileage", "mileageUnit", "fullTank", "consumption", "station", "isDemo", "notes",
        ],
        fuel.map((f) => [
          f.id, iso(f.date), [f.vehicle.year, f.vehicle.brand, f.vehicle.model].filter(Boolean).join(" "),
          f.amountCents, f.currency, f.liters, f.kwh, f.pricePerUnit, f.mileage, f.mileageUnit,
          f.fullTank, f.consumption, f.station, f.isDemo, f.notes,
        ])
      )
    );
  }

  if (dataset === "all" || dataset === "trips") {
    const trips = await db.trip.findMany({
      where: { userId: user.id },
      orderBy: { date: "asc" },
    });
    const vehicles = await db.vehicle.findMany({
      where: { userId: user.id },
      select: { id: true, nickname: true, brand: true, model: true, year: true },
    });
    const label = new Map(
      vehicles.map((v) => [
        v.id,
        v.nickname ?? [v.year, v.brand, v.model].filter(Boolean).join(" "),
      ])
    );
    rowCount += trips.length;
    const { columns, rows } = tripCsvSection(trips, (id) => label.get(id) ?? "");
    sections.push(section("Trips", columns, rows));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const header = [
    `# AutoEco data export`,
    `# account: ${user.email}`,
    `# generated: ${new Date().toISOString()}`,
    `# rows: ${rowCount}`,
    `# Rows marked isDemo=true are sample data seeded into your account, not entries you typed.`,
    `# Receipt images are not included; only their references.`,
    `# A trip's deduction is your own rate, snapshotted when you logged it. Blank means you had no rate set.`,
  ].join("\n");

  const body = sections.join("\n\n");
  const csv = `${header}\n\n${body}\n`;

  await auditLog({
    userId: user.id,
    action: "account.data_exported",
    metadata: { dataset, rowCount },
    ip,
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="autoeco-export-${dataset}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
});