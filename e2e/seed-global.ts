/**
 * Screenshot-capture setup: makes sure the demo user and their sample data
 * exist in the local test database, with a password taken from the
 * SCREENSHOT_DEMO_PASSWORD environment variable (never hard-coded).
 *
 * Seeding steps are printed so the generated shots are auditable: an inspector
 * knows exactly what account the pixel content belongs to.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();

  const dbHost = (process.env.DATABASE_URL ?? "").replace(/\+.*/, "");
  const email = (process.env.SCREENSHOT_DEMO_EMAIL || "demo@autoeco.app").toLowerCase();
  const password = process.env.SCREENSHOT_DEMO_PASSWORD;

  console.log("Screenshot capture — setup");
  console.log(`  1. Target database: ${dbHost}`);
  console.log(`  2. Demo user: ${email} (password from SCREENSHOT_DEMO_PASSWORD)`);
  console.log("     Upserting the demo user with that password…");

  if (!password) {
    await prisma.$disconnect();
    throw new Error("SCREENSHOT_DEMO_PASSWORD must be set to log the demo user in.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  const free = await prisma.plan.findUnique({ where: { key: "free" } });
  let userId: string;

  if (existing) {
    // Keep the password in sync with the env var so the screenshots always
    // succeed no matter what a previous `prisma db seed` ran.
    await prisma.user.update({
      where: { email },
      data: { passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() },
    });
    userId = existing.id;
    console.log(`     Existing demo user updated (password + verified).`);
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        name: "Demo User",
        emailVerifiedAt: new Date(),
        planId: free?.id ?? null,
        currency: "USD",
        distanceUnit: "km",
        fuelUnit: "L_PER_100KM",
      },
    });
    userId = user.id;
    console.log(`     New demo user created (${email}).`);
  }

  console.log("  3. Vehicle + 6 months of fuel/expenses (only if missing)…");
  const vehicle = await prisma.vehicle.findFirst({ where: { userId, isDemo: true } });
  if (!vehicle) {
    const v = await prisma.vehicle.create({
      data: {
        userId,
        brand: "Toyota",
        model: "Corolla",
        year: 2021,
        fuelType: "gasoline",
        transmission: "CVT",
        fuelEconomyText: "6.0 L/100km",
        purchaseDate: new Date("2022-03-15"),
        purchasePriceCents: 2200000,
        purchaseCurrency: "USD",
        currentMileage: 32000,
        currentMileageUnit: "km",
        isPrimary: true,
        isDemo: true,
      },
    });
    const now = new Date();
    const fuel = await prisma.fuelEntry.count({ where: { userId } });
    const expenses = await prisma.expense.count({ where: { userId } });
    if (fuel + expenses === 0) {
      for (let i = 0; i < 6; i++) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - (6 - i));
        await prisma.fuelEntry.create({
          data: {
            userId,
            vehicleId: v.id,
            date: d,
            amountCents: 5500 + (i * 137) % 1500,
            currency: "USD",
            liters: 38 + i * 1.1,
            pricePerUnit: 1.45 + (i % 4) * 0.05,
            mileage: 30000 - (6 - i) * 1100 + i * 90,
            mileageUnit: "km",
            fullTank: true,
            station: "Sample Station",
            consumption: 6.2 + (i % 5) * 0.1,
            isDemo: true,
          },
        });
        await prisma.expense.create({
          data: {
            userId,
            vehicleId: v.id,
            category: ["maintenance", "insurance", "parking", "tolls", "other"][i % 5] as never,
            amountCents: [12000, 9000, 3500, 2000, 5500][i % 5],
            currency: "USD",
            date: d,
            merchant: "Sample",
            isDemo: true,
          },
        });
      }
      console.log(`     Created demo vehicle + 6 months of fuel and expenses.`);
    }
  } else {
    console.log(`     Demo vehicle already present (${vehicle.brand} ${vehicle.model}).`);
  }

  console.log("  4. Server runs via playwright webServer on http://127.0.0.1:3210");
  console.log("     (PREVIEW_PENDING_LOCALES=1 so Arabic renders as real Arabic).");
  console.log("     Output: docs/screenshots/ (git-ignored).\n");

  await prisma.$disconnect();
}