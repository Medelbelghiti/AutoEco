"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TripFormFields, type TripFormValues } from "@/components/trips/TripFormFields";
import { useT } from "@/components/LocaleProvider";

export function EditTripForm({
  trip,
  vehicles,
}: {
  trip: {
    id: string;
    vehicleId: string;
    date: string;
    purpose: string;
    startOdometer: number | null;
    endOdometer: number | null;
    distance: number | null;
    distanceUnit: string;
    note: string | null;
  };
  vehicles: { id: string; label: string }[];
}) {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(values: TripFormValues) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || t("trips.update_failed"));
        return;
      }
      router.push("/trips");
      router.refresh();
    } catch {
      setError(t("common.network_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void onSubmit({
          vehicleId: String(data.get("vehicleId") ?? ""),
          date: String(data.get("date") ?? ""),
          purpose: String(data.get("purpose") ?? "business") as TripFormValues["purpose"],
          startOdometer: toNumberOrNull(data.get("startOdometer")),
          endOdometer: toNumberOrNull(data.get("endOdometer")),
          distance: toNumberOrNull(data.get("distance")),
          distanceUnit: String(data.get("distanceUnit") ?? trip.distanceUnit) as TripFormValues["distanceUnit"],
          note: String(data.get("note") ?? "").trim() || null,
        });
      }}
      className="space-y-5"
    >
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <TripFormFields
        vehicles={vehicles}
        defaults={{
          date: trip.date,
          purpose: trip.purpose as TripFormValues["purpose"],
          distanceUnit: trip.distanceUnit as TripFormValues["distanceUnit"],
          note: trip.note ?? "",
          startOdometer: trip.startOdometer,
          endOdometer: trip.endOdometer,
          distance: trip.distance,
        }}
        submitLabel={busy ? t("common.saving") : t("common.save_changes")}
        disabled={busy}
      />
    </form>
  );
}

function toNumberOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}