"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TripFormFields, type TripFormValues } from "@/components/trips/TripFormFields";

/**
 * Create form for a trip.
 *
 * Accepts either an odometer pair or a plain distance; the API decides which is
 * valid, so the client does not duplicate those rules beyond sending both when
 * the user filled them in.
 */
export function NewTripForm({
  vehicles,
  defaultUnit,
}: {
  vehicles: { id: string; label: string }[];
  defaultUnit: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(values: TripFormValues) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Could not save this trip.");
        return;
      }
      router.push("/trips");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
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
          distanceUnit: (String(data.get("distanceUnit") ?? "").trim() ||
            defaultUnit) as TripFormValues["distanceUnit"],
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
        defaults={{ distanceUnit: defaultUnit as TripFormValues["distanceUnit"] }}
        submitLabel={busy ? "Saving…" : "Add trip"}
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