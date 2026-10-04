import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney } from "@/lib/finance";
import { getEntitlements } from "@/lib/quota";

const InputSchema = z.object({
  vehicleId: z.string(),
  name: z.string().min(1).max(80),
  type: z.enum(["keep_vs_replace", "fuel_price", "mileage_change", "repair_vs_replace"]),
  // CLIENT sends inputs only. Outputs are server-generated.
  inputs: z.object({
    fuelDeltaPct: z.number().min(-100).max(500).optional(),
    horizonMonths: z.number().int().min(1).max(600).default(36),
    extraKmPerYear: z.number().int().min(0).max(200000).optional(),
    replacePriceCents: z.number().int().min(0).max(1_000_000_000_000).optional(),
    repairCostCents: z.number().int().min(0).max(1_000_000_000).optional(),
    // For repair_vs_replace: how many months of remaining ownership if you keep.
    monthsRemainingIfKept: z.number().int().min(1).max(120).optional(),
  }),
});

export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  const scenarios = await db.scenario.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return ok({ scenarios });
});

/**
 * Server-side scenario calculation with explicit entitlement gate.
 *
 *   keep_vs_replace:      current vehicle operating cost * horizon
 *                         + capital delta (resale - replace price)
 *
 *   repair_vs_replace:    scenario A (repair): repair cost + keep * remaining months
 *                         scenario B (replace): purchase - resale + replace * remaining months
 *                         The two scenarios are compared over the SAME remaining horizon.
 *
 * Both scenarios use the ACTUAL monthly average as the operating-cost estimate.
 * CLIENT-supplied outputs are ignored.
 */
export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await parseJson(req, InputSchema);

  // 1. Authentication
  // 2. Ownership
  const vehicle = await db.vehicle.findUnique({ where: { id: body.vehicleId } });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  assertOwnership(vehicle.userId, user);

  // 3. Entitlement gate
  const ent = await getEntitlements(user);
  if (!ent.enableAdvancedScenarios) {
    return NextResponse.json({ error: "Advanced scenarios are not included in your plan.", code: "ADVANCED_SCENARIOS_NOT_INCLUDED" }, { status: 403 });
  }

  // 4. Compute ACTUAL base metrics from DB
  const costResult = await computeVehicleCost(user.id, vehicle.id);
  if (!costResult.ok) {
    return NextResponse.json({ error: "Cannot compute scenario: mixed-currency data", code: "MIXED_CURRENCY" }, { status: 422 });
  }
  const summary = costResult.summary;
  const currency = summary.baseCurrency;
  const inputs = body.inputs;

  // Fuel delta applies only to the fuel portion of monthly spend.
  const fuelShare = summary.totalFuel / Math.max(1, summary.totalSpent);
  const projectedMonthly = Math.round(summary.monthlyAverage * (1 + ((inputs.fuelDeltaPct ?? 0) / 100) * fuelShare));

  // 5. Per-type computation
  let keepCents = 0;
  let replaceCents = 0;
  let label = "";
  const assumptions: string[] = [
    `Base monthly cost (ACTUAL): ${formatMoney(summary.monthlyAverage, currency)}`,
    `Fuel share (ACTUAL): ${(fuelShare * 100).toFixed(0)}%`,
  ];

  if (body.type === "keep_vs_replace") {
    label = "Keep vs Replace";
    const horizon: number = inputs.horizonMonths ?? 36;
    keepCents = projectedMonthly * horizon;
    if (inputs.replacePriceCents != null) {
      const resale = vehicle.estimatedResaleCents
        ?? (vehicle.purchasePriceCents ? Math.round(vehicle.purchasePriceCents * 0.5) : 0);
      replaceCents = inputs.replacePriceCents - resale + projectedMonthly * horizon;
      assumptions.push(`Current vehicle resale (ESTIMATE): ${formatMoney(resale, currency)}`);
      assumptions.push(`Replacement price (USER INPUT): ${formatMoney(inputs.replacePriceCents, currency)}`);
    }
    assumptions.push(`Horizon: ${horizon} months`);
  } else if (body.type === "repair_vs_replace") {
    label = "Repair vs Replace";
    const remainingMonths: number = inputs.monthsRemainingIfKept ?? 12;
    keepCents = (inputs.repairCostCents ?? 0) + projectedMonthly * remainingMonths;
    if (inputs.replacePriceCents != null) {
      const resale = vehicle.estimatedResaleCents
        ?? (vehicle.purchasePriceCents ? Math.round(vehicle.purchasePriceCents * 0.5) : 0);
      replaceCents = inputs.replacePriceCents - resale + projectedMonthly * remainingMonths;
      assumptions.push(`Current vehicle resale (ESTIMATE): ${formatMoney(resale, currency)}`);
      assumptions.push(`Replacement price (USER INPUT): ${formatMoney(inputs.replacePriceCents, currency)}`);
    }
    assumptions.push(`Repair cost (USER INPUT): ${formatMoney(inputs.repairCostCents ?? 0, currency)}`);
    assumptions.push(`Remaining ownership horizon: ${remainingMonths} months`);
  } else {
    label = body.type;
    const horizon: number = inputs.horizonMonths ?? 36;
    keepCents = projectedMonthly * horizon;
    replaceCents = keepCents;
    assumptions.push(`Horizon: ${horizon} months`);
  }

  const diffCents = replaceCents - keepCents;
  const outputs = {
    type: body.type,
    label,
    currency,
    baseMonthly: projectedMonthly,
    keepCents,
    replaceCents,
    diffCents,
    assumptions,
  };

  const created = await db.scenario.create({
    data: {
      userId: user.id,
      vehicleId: body.vehicleId,
      name: body.name,
      type: body.type,
      inputsJson: JSON.stringify(inputs),
      outputsJson: JSON.stringify(outputs),
    },
  });
  return ok({ scenario: created, outputs });
});
