import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NewTripForm } from "@/components/trips/NewTripForm";

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const vehicles = await db.vehicle.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, nickname: true, brand: true, model: true, year: true },
  });

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold">Add trip</h1>
      <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-1 mb-6">
        Record the distance you drove so it counts towards your yearly log.
      </p>
      {vehicles.length === 0 ? (
        <p className="text-sm text-charcoal-600 dark:text-charcoal-400">
          Add a vehicle in your Garage first.
        </p>
      ) : (
        <NewTripForm
          vehicles={vehicles.map((v) => ({
            id: v.id,
            label: v.nickname ?? [v.year, v.brand, v.model].filter(Boolean).join(" "),
          }))}
          defaultUnit={user.distanceUnit}
        />
      )}
    </div>
  );
}