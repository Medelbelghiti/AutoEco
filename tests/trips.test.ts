/**
 * Trip log integration tests (real DB).
 *
 * These cover what a pure unit test cannot: that the quota counter actually
 * stops a user at their plan limit under concurrency, that a snapshot rate is
 * not rewritten when the user later changes their preference, and that deleting
 * a vehicle takes its trips with it rather than orphaning the rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tryConsume, release, buildPeriodKey } from "@/lib/quota";
import { getTripSummaries } from "@/lib/trips-queries";
import { getEntitlements } from "@/lib/plans";
import { ensureTripSchema } from "./_ensureSchema";
import { DB_OK } from "./_dbGuard";

const prisma = new PrismaClient();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  if (DB_OK) await ensureTripSchema(prisma);
});

async function makeUser(planOverrides: Record<string, unknown> = {}, userOverrides: Record<string, unknown> = {}) {
  const plan = await prisma.plan.create({
    data: {
      key: `t_${stamp}_${Math.random().toString(36).slice(2, 8)}`,
      name: "Test", priceCents: 0, billingPeriod: "FREE",
      maxVehicles: 5, maxExpensesPerMonth: 1000,
      aiReceiptScansPerMonth: 100, aiConversationsPerMonth: 100,
      reportRetentionDays: 30, forecastHorizonMonths: 12,
      enableAdvancedScenarios: true, enableShareableReports: true,
      enableFamilySharing: false, enableApiAccess: false,
      features: "[]",
      ...planOverrides,
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `${stamp}-${Math.random().toString(36).slice(2, 8)}@autoeco.app`,
      passwordHash: "x", name: "T", role: "USER",
      planId: plan.id, currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM",
      stripeCustomerId: `cus_test_${Math.random().toString(36).slice(2, 8)}`,
      ...userOverrides,
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: { userId: user.id, nickname: "V", brand: "B", model: "M", year: 2020 },
  });
  return { user, plan, vehicle };
}

async function cleanup() {
  try {
    const ids = `(SELECT id FROM "User" WHERE email LIKE '${stamp}-%@autoeco.app')`;
    await prisma.$executeRawUnsafe(`DELETE FROM "QuotaUsage" WHERE "userId" IN ${ids}`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Trip" WHERE "userId" IN ${ids}`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Vehicle" WHERE "userId" IN ${ids}`);
    await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE email LIKE '${stamp}-%@autoeco.app'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Plan" WHERE key LIKE 't_${stamp}_%'`);
  } catch {
    // noop
  }
}

describe.skipIf(!DB_OK)("trip log (real DB)", () => {
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("stores a fractional distance that survived the round trip", async () => {
    const { user, vehicle } = await makeUser();
    const trip = await prisma.trip.create({
      data: {
        userId: user.id, vehicleId: vehicle.id,
        date: new Date("2026-04-01T00:00:00Z"), purpose: "business",
        distance: 12.5, distanceUnit: "km",
      },
    });
    // The whole reason `distance` is DOUBLE PRECISION: a whole-number column
    // would round 12.5 km to 12 or 13 and silently change a mileage figure.
    expect(trip.distance).toBe(12.5);
  });

  it("keeps the rate snapshotted on the trip when the user later changes it", async () => {
    const { user, vehicle } = await makeUser(
      {},
      { mileageDeductionRateCents: 30, mileageDeductionCurrency: "EUR", mileageDeductionUnit: "km" }
    );
    const trip = await prisma.trip.create({
      data: {
        userId: user.id, vehicleId: vehicle.id,
        date: new Date("2026-04-02T00:00:00Z"), purpose: "business",
        distance: 100, distanceUnit: "km",
        deductionRateCents: user.mileageDeductionRateCents,
        deductionCurrency: user.mileageDeductionCurrency,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { mileageDeductionRateCents: 99, mileageDeductionCurrency: "USD" },
    });

    const after = await prisma.trip.findUnique({ where: { id: trip.id } });
    // The trip may already be part of a filed return; changing today's rate must
    // not restate a figure the user recorded months ago.
    expect(after!.deductionRateCents).toBe(30);
    expect(after!.deductionCurrency).toBe("EUR");

    await prisma.user.update({
      where: { id: user.id },
      data: { mileageDeductionRateCents: null, mileageDeductionCurrency: null, mileageDeductionUnit: null },
    });
  });

  it("exposes the plan's trip limit through entitlements", async () => {
    const { user } = await makeUser({ maxTripsPerMonth: 42 });
    const ent = await getEntitlements(user);
    expect(ent.maxTripsPerMonth).toBe(42);
  });

  it("counts a year per calendar year and never mixes currencies", async () => {
    const { user, vehicle } = await makeUser();
    await prisma.trip.createMany({
      data: [
        { userId: user.id, vehicleId: vehicle.id, date: new Date("2025-05-01T00:00:00Z"), purpose: "business", distance: 100, distanceUnit: "km", deductionRateCents: 30, deductionCurrency: "EUR" },
        { userId: user.id, vehicleId: vehicle.id, date: new Date("2026-05-01T00:00:00Z"), purpose: "personal", distance: 50, distanceUnit: "km", deductionRateCents: 30, deductionCurrency: "USD" },
        { userId: user.id, vehicleId: vehicle.id, date: new Date("2026-06-01T00:00:00Z"), purpose: "business", distance: 25, distanceUnit: "mi" },
      ],
    });

    const res = await getTripSummaries(user.id);
    expect(res.years.sort()).toEqual([2025, 2026]);
    const y2026 = res.summaries.find((s) => s.year === 2026)!;
    expect(y2026.tripCount).toBe(2);
    expect(y2026.distance).toEqual({ km: 50, mi: 25 });
    expect(y2026.deductions).toHaveLength(1);
    expect(y2026.deductions[0].currency).toBe("USD");
    expect(y2026.byPurpose).toHaveLength(2);

    await prisma.user.update({
      where: { id: user.id },
      data: { mileageDeductionRateCents: 30, mileageDeductionCurrency: "EUR", mileageDeductionUnit: "km" },
    });
  });

  it("only reports a deduction rate the user actually has", async () => {
    const { user } = await makeUser();
    expect((await getTripSummaries(user.id)).hasDeductionRate).toBe(false);

    await prisma.user.update({
      where: { id: user.id },
      data: { mileageDeductionRateCents: 25, mileageDeductionCurrency: "EUR", mileageDeductionUnit: "km" },
    });
    expect((await getTripSummaries(user.id)).hasDeductionRate).toBe(true);
  });

  it("stops a user at the plan's monthly trip limit under concurrency", async () => {
    const { user } = await makeUser({ maxTripsPerMonth: 5 });
    const ent = await getEntitlements(user);
    const periodKey = buildPeriodKey(new Date(), { trial: ent.isTrial, userId: user.id });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        tryConsume({ userId: user.id, metric: "trips", periodKey, limit: 5 })
      )
    );
    // 20 simultaneous attempts against a limit of 5: the counter must admit
    // exactly 5, never more, or the plan limit is advisory.
    expect(results.filter((r) => r.allowed)).toHaveLength(5);

    await release({ userId: user.id, metric: "trips", periodKey });
    const after = await tryConsume({ userId: user.id, metric: "trips", periodKey, limit: 5 });
    expect(after.allowed).toBe(true);
  });

  it("refuses every trip once the limit is zero", async () => {
    const { user } = await makeUser({ maxTripsPerMonth: 0 });
    const periodKey = buildPeriodKey(new Date(), { userId: user.id });
    const r = await tryConsume({ userId: user.id, metric: "trips", periodKey, limit: 0 });
    expect(r.allowed).toBe(false);
  });

  it("deletes a vehicle's trips along with it", async () => {
    const { user, vehicle } = await makeUser();
    const trip = await prisma.trip.create({
      data: {
        userId: user.id, vehicleId: vehicle.id,
        date: new Date("2026-07-01T00:00:00Z"), purpose: "commute", distance: 30, distanceUnit: "km",
      },
    });
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    // No orphaned trip pointing at a vehicle that no longer exists.
    expect(await prisma.trip.findUnique({ where: { id: trip.id } })).toBeNull();
  });

  it("keeps one user's trips out of another user's summary", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await prisma.trip.create({
      data: {
        userId: a.user.id, vehicleId: a.vehicle.id,
        date: new Date("2026-08-01T00:00:00Z"), purpose: "business", distance: 999, distanceUnit: "km",
      },
    });
    const res = await getTripSummaries(b.user.id);
    expect(res.summaries).toHaveLength(0);
    expect(res.years).toEqual([]);
  });

  it("aggregates many trips in one year", async () => {
    const { user, vehicle } = await makeUser();
    const rows = Array.from({ length: 10 }, (_, i) => ({
      userId: user.id, vehicleId: vehicle.id,
      date: new Date(Date.UTC(2026, 0, 1 + (i % 28))),
      purpose: "business", distance: 1 + i, distanceUnit: "km",
    }));
    await prisma.trip.createMany({ data: rows });
    const res = await getTripSummaries(user.id);
    expect(res.summaries[0].tripCount).toBe(10);
    expect(res.summaries[0].distance.km).toBe(55);
  });
});