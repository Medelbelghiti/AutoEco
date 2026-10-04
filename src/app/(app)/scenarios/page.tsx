import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import ScenarioForm from "./ScenarioForm";

export default async function ScenariosPage() {
  const user = await requireUser();
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ isPrimary: "desc" }] });

  if (vehicles.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">What-If Scenarios</h1>
        <p className="text-sm text-charcoal-500 mt-2">Add a vehicle to start running scenarios.</p>
        <Link href="/garage/new" className="btn btn-accent mt-4 inline-flex">Add a vehicle</Link>
      </div>
    );
  }

  const primary = vehicles[0];
  const result = await computeVehicleCost(user.id, primary.id);
  const saved = await db.scenario.findMany({ where: { userId: user.id, vehicleId: primary.id }, orderBy: { createdAt: "desc" }, take: 10 });

  if (!result.ok) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold">What-If Scenarios</h1>
        <div className="card border-amber-300 bg-amber-50 mt-4">
          <p className="font-semibold text-amber-800">Mixed-currency data</p>
          <p className="text-sm text-amber-700 mt-1">Cannot run scenarios until your entries use a single currency.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold">What-If Scenarios</h1>
      <p className="text-sm text-charcoal-500">Compare the cost of keeping your current car vs replacing it. All assumptions are shown.</p>
      <ScenarioForm summary={result.summary} vehicle={primary} />
      {saved.length > 0 && (
        <div className="card mt-6">
          <p className="font-semibold">Saved scenarios</p>
          <ul className="mt-3 space-y-2 text-sm">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                <span>{s.name} - {s.type}</span>
                <span className="text-xs text-charcoal-500">{new Date(s.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
