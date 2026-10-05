"use client";

import Link from "next/link";
import { TRIP_PURPOSES, type TripDistanceUnit } from "@/lib/trips";

export interface TripFormValues {
  vehicleId: string;
  date: string;
  purpose: (typeof TRIP_PURPOSES)[number];
  startOdometer: number | null;
  endOdometer: number | null;
  distance: number | null;
  distanceUnit: TripDistanceUnit;
  note: string | null;
}

const PURPOSE_LABELS: Record<string, string> = {
  business: "Business",
  personal: "Personal",
  commute: "Commute",
};

const field =
  "w-full rounded-lg border border-charcoal-300 dark:border-charcoal-700 bg-white dark:bg-charcoal-900 px-3 py-2 text-sm";
const label = "block text-sm font-medium mb-1";
const help = "mt-1 text-xs text-charcoal-600 dark:text-charcoal-400";

/**
 * Shared fields for the create and edit forms.
 *
 * Distance is expressed two ways on purpose: some people have an odometer, some
 * just remember the number. Exactly one has to be filled in, and the API
 * validates that, so the hint here states the rule instead of hiding one input.
 */
export function TripFormFields({
  vehicles,
  defaults,
  submitLabel,
  disabled,
  cancelHref = "/trips",
}: {
  vehicles: { id: string; label: string }[];
  defaults?: Partial<
    Pick<
      TripFormValues,
      | "date"
      | "purpose"
      | "distanceUnit"
      | "note"
      | "startOdometer"
      | "endOdometer"
      | "distance"
    >
  >;
  submitLabel: string;
  disabled?: boolean;
  cancelHref?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="vehicleId" className={label}>
          Vehicle
        </label>
        <select id="vehicleId" name="vehicleId" required className={field}>
          <option value="">Choose a vehicle</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="date" className={label}>
            Date
          </label>
          <input
            type="date"
            id="date"
            name="date"
            required
            defaultValue={defaults?.date ?? today}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="purpose" className={label}>
            Purpose
          </label>
          <select
            id="purpose"
            name="purpose"
            required
            defaultValue={defaults?.purpose ?? "business"}
            className={field}
          >
            {TRIP_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p] ?? p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="rounded-lg border border-charcoal-200 dark:border-charcoal-800 p-4 space-y-4">
        <legend className="px-1 text-sm font-medium">How far did you drive?</legend>
        <p className={help}>
          Fill in either the odometer before and after, or the distance itself. Fill in
          one, not both.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="startOdometer" className={label}>
              Odometer before
            </label>
            <input
              type="number"
              id="startOdometer"
              name="startOdometer"
              step="1"
              min="0"
              inputMode="numeric"
              defaultValue={defaults?.startOdometer ?? ""}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="endOdometer" className={label}>
              Odometer after
            </label>
            <input
              type="number"
              id="endOdometer"
              name="endOdometer"
              step="1"
              min="0"
              inputMode="numeric"
              defaultValue={defaults?.endOdometer ?? ""}
              className={field}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="distance" className={label}>
              Distance
            </label>
            <input
              type="number"
              id="distance"
              name="distance"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={defaults?.distance ?? ""}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="distanceUnit" className={label}>
              Unit
            </label>
            <select
              id="distanceUnit"
              name="distanceUnit"
              defaultValue={defaults?.distanceUnit ?? "km"}
              className={field}
            >
              <option value="km">km</option>
              <option value="mi">mi</option>
            </select>
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor="note" className={label}>
          Note <span className="font-normal text-charcoal-500">(optional)</span>
        </label>
        <textarea
          id="note"
          name="note"
          rows={2}
          maxLength={2000}
          defaultValue={defaults?.note ?? ""}
          className={field}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={disabled}
          className="px-4 py-2 rounded-lg bg-charcoal-900 dark:bg-white text-white dark:text-charcoal-900 text-sm font-medium disabled:opacity-60"
        >
          {submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="px-3 py-2 rounded-lg border border-charcoal-300 dark:border-charcoal-700 text-sm font-medium"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}