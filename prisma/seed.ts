/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();
import { PLANS, planRow } from "./plans.data";

function generateStrongPassword(): string {
  // 24-char base64url password. NEVER reuse a default like "change-me-admin".
  return crypto.randomBytes(18).toString("base64url");
}

async function main() {
  const isProd = process.env.NODE_ENV === "production";

  // 1. Feature flags
  const flags: Array<[string, boolean, string]> = [
    ["ai_receipt_scan", true, "OCR receipt scanning"],
    ["ai_conversations", true, "AI 'Ask my car' chat"],
    ["ai_enrichment", false, "Optional AI enrichment"],
    ["registration", true, "Allow new signups"],
    ["shareable_reports", true, "Public share links"],
    ["advanced_scenarios", true, "Repair vs Replace simulator"],
  ];
  for (const [key, enabled, description] of flags) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description },
      update: { enabled, description },
    });
  }

  // 2. Settings
  const settings: Array<[string, string]> = [
    ["trial_enabled", "true"],
    ["trial_duration_days", "14"],
    ["trial_lead_limit", "200"],
    ["default_currency", "USD"],
    ["default_distance_unit", "km"],
    ["default_fuel_unit", "L_PER_100KM"],
  ];
  for (const [key, value] of settings) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  // 3. Plans — canonical definitions live in `prisma/plans.data.ts` so that
  // `scripts/seed-plans.ts` can repair the plan table in production without
  // re-declaring (and eventually contradicting) this matrix.
  for (const p of PLANS) {
    const row = planRow(p);
    const { key, ...fields } = row;
    await prisma.plan.upsert({
      where: { key: key as string },
      // `isDemo: false` is explicit rather than left to the column default:
      // this is a real, purchasable plan and must never be filtered out of
      // pricing by the isDemo guard that hides test fixtures.
      create: { ...row, isDemo: false } as never,
      update: { ...fields, isDemo: false } as never,
    });
  }

  // 4. Vehicle catalog (verified=false, manual entry always available)
  // `VehicleCatalogEntry` names this column `fuelEconomyCombined`; the
  // user-owned `Vehicle` row uses `fuelEconomyText`. Copying the wrong field
  // name here made the whole seed abort on the first catalog insert.
  const samples = [
    { brand: "Toyota", model: "Corolla", yearFrom: 2018, yearTo: 2023, fuelType: "gasoline", fuelEconomyCombined: "6.0 L/100km" },
    { brand: "Toyota", model: "RAV4", yearFrom: 2019, yearTo: 2024, fuelType: "hybrid", fuelEconomyCombined: "5.8 L/100km" },
    { brand: "Honda", model: "Civic", yearFrom: 2016, yearTo: 2024, fuelType: "gasoline", fuelEconomyCombined: "6.4 L/100km" },
    { brand: "BMW", model: "X5", yearFrom: 2019, yearTo: 2024, fuelType: "diesel", fuelEconomyCombined: "7.5 L/100km" },
    { brand: "Tesla", model: "Model 3", yearFrom: 2019, yearTo: 2024, fuelType: "ev", fuelEconomyCombined: "15 kWh/100km", batteryCapacityKwh: 60 },
    { brand: "Renault", model: "Clio", yearFrom: 2019, yearTo: 2024, fuelType: "gasoline", fuelEconomyCombined: "5.2 L/100km" },
    { brand: "Peugeot", model: "208", yearFrom: 2019, yearTo: 2024, fuelType: "gasoline", fuelEconomyCombined: "4.8 L/100km" },
    { brand: "Dacia", model: "Duster", yearFrom: 2018, yearTo: 2024, fuelType: "gasoline", fuelEconomyCombined: "7.1 L/100km" },
    { brand: "Hyundai", model: "Tucson", yearFrom: 2020, yearTo: 2024, fuelType: "hybrid", fuelEconomyCombined: "5.6 L/100km" },
    { brand: "Volkswagen", model: "Golf", yearFrom: 2017, yearTo: 2024, fuelType: "gasoline", fuelEconomyCombined: "5.5 L/100km" },
  ];
  for (const s of samples) {
    const exists = await prisma.vehicleCatalogEntry.findFirst({ where: { brand: s.brand, model: s.model } });
    if (!exists) await prisma.vehicleCatalogEntry.create({ data: { ...s, verified: false } });
  }

  // 5. Admin user — NEVER use a known default password in production.
  //    In production, require SEED_ADMIN_PASSWORD env var to be set.
  //    In dev, generate a random password and print it once.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@autoeco.app").toLowerCase();
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const free = await prisma.plan.findUnique({ where: { key: "free" } });
    let adminPassword: string;
    if (process.env.SEED_ADMIN_PASSWORD) {
      adminPassword = process.env.SEED_ADMIN_PASSWORD;
    } else if (isProd) {
      throw new Error(
        "PRODUCTION SEED BLOCKED: SEED_ADMIN_PASSWORD env var is required to seed an admin in production. " +
        "Refusing to create an admin account with a known default password."
      );
    } else {
      adminPassword = generateStrongPassword();
    }
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        name: "Administrator", role: "ADMIN", emailVerifiedAt: new Date(),
        planId: free?.id ?? null, currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM",
      },
    });
    console.log(`+ Admin: ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD ? "(from env)" : adminPassword}`);
    if (!process.env.SEED_ADMIN_PASSWORD && !isProd) {
      console.log("  ^^ Save this password now — it will not be shown again.");
    }
  }

  // 6. Demo user + sample data — ONLY in development.
  if (!isProd) {
    const demoEmail = "demo@autoeco.app";
    const existingDemo = await prisma.user.findUnique({ where: { email: demoEmail } });
    if (!existingDemo) {
      const free = await prisma.plan.findUnique({ where: { key: "free" } });
      const demoUser = await prisma.user.create({
        data: {
          email: demoEmail,
          passwordHash: await bcrypt.hash("demo-password", 12),
          name: "Demo User", emailVerifiedAt: new Date(),
          planId: free?.id ?? null, currency: "USD", distanceUnit: "km", fuelUnit: "L_PER_100KM",
        },
      });
      const vehicle = await prisma.vehicle.create({
        data: {
          userId: demoUser.id, brand: "Toyota", model: "Corolla", year: 2021,
          fuelType: "gasoline", transmission: "CVT", fuelEconomyText: "6.0 L/100km",
          purchaseDate: new Date("2022-03-15"), purchasePriceCents: 2200000, purchaseCurrency: "USD",
          currentMileage: 32000, currentMileageUnit: "km", isPrimary: true, isDemo: true,
        },
      });
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now);
        d.setMonth(d.getMonth() - (6 - i));
        await prisma.fuelEntry.create({
          data: {
            userId: demoUser.id, vehicleId: vehicle.id, date: d,
            amountCents: 5500 + Math.floor(Math.random() * 1500), currency: "USD",
            liters: 38 + Math.random() * 6, pricePerUnit: 1.45 + Math.random() * 0.2,
            mileage: 30000 - (6 - i) * 1100 + Math.floor(Math.random() * 200), mileageUnit: "km",
            fullTank: true, station: "Sample Station", consumption: 6.2 + (Math.random() - 0.5) * 0.6, isDemo: true,
          },
        });
        await prisma.expense.create({
          data: {
            userId: demoUser.id, vehicleId: vehicle.id,
            category: ["maintenance", "insurance", "parking", "tolls", "other"][i % 5] as any,
            amountCents: [12000, 9000, 3500, 2000, 5500][i % 5],
            currency: "USD", date: d, merchant: `Sample`, isDemo: true,
          },
        });
      }
      console.log(`+ Demo user: ${demoEmail} / demo-password (development only)`);
    }
  }

  console.log("AutoEco seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
