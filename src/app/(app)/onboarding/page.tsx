import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { OnboardingForm } from "./Form";

export default async function OnboardingPage() {
  const user = await requireUser();
  // If user already has a vehicle, skip onboarding
  const count = await db.vehicle.count({ where: { userId: user.id } });
  if (count > 0) redirect("/dashboard");
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Welcome to AutoEco</h1>
      <p className="text-sm text-charcoal-500 mt-1">Tell us your preferences so we can show your numbers in the right unit.</p>
      <OnboardingForm defaults={{ currency: user.currency, distanceUnit: user.distanceUnit, fuelUnit: user.fuelUnit }} />
    </div>
  );
}
