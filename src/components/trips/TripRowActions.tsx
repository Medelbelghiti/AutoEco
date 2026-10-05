"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";

/**
 * Edit/delete for a single logged trip.
 *
 * Deleting asks for confirmation because a trip is part of a yearly log the user
 * may have already filed; the row is only removed once the DELETE succeeded, so
 * a failed request leaves the data visible instead of pretending it worked.
 */
export function TripRowActions({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function remove() {
    setError(null);
    const res = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete this trip.");
      return;
    }
    setConfirming(false);
    startTransition(() => router.refresh());
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="px-2 py-1 rounded-md bg-red-600 text-white text-xs font-medium disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Confirm delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="px-2 py-1 rounded-md border border-charcoal-300 dark:border-charcoal-700 text-xs font-medium"
        >
          Cancel
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <a
        href={`/trips/${tripId}/edit`}
        aria-label="Edit trip"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-charcoal-600 dark:text-charcoal-400 hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
      >
        <Pencil className="w-4 h-4" aria-hidden="true" />
      </a>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete trip"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-charcoal-600 dark:text-charcoal-400 hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}