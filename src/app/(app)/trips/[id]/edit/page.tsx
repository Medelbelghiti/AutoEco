import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EditTripForm } from "@/components/trips/EditTripForm";

export const dynamic = "force-dynamic";

export default async function EditTripPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const trip = await db.trip.findUnique({ where: { id: params.id } });
  // Not found and not yours are deliberately indistinguishable: a wrong id must
  // not confirm that somebody else's trip exists.
  if (!trip || trip.userId !== user.id) notFound();

  const vehicles = await db.vehicle.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, nickname: true, brand: true, model: true, year: true },
  });

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold">Edit trip</h1>
      <p className="text-sm text-charcoal-600 dark:text-charcoal-400 mt-1 mb-6">
        Correct a distance or change what this trip was for.
      </p>
      <EditTripForm
        trip={{
          id: trip.id,
          vehicleId: trip.vehicleId,
          date: trip.date.toISOString().slice(0, 10),
          purpose: trip.purpose,
          startOdometer: trip.startOdometer,
          endOdometer: trip.endOdometer,
          distance: trip.distance,
          distanceUnit: trip.distanceUnit,
          note: trip.note,
        }}
        vehicles={vehicles.map((v) => ({
          id: v.id,
          label: v.nickname ?? [v.year, v.brand, v.model].filter(Boolean).join(" "),
        }))}
      />
    </div>
  );
}