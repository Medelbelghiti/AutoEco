"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/LocaleProvider";

/**
 * Delete an expense from its edit page.
 *
 * Confirmation runs in the browser and the deletion is a real `DELETE`
 * request, so a success sends the user back to the list and a failure shows a
 * translated message instead of navigating to a JSON body.
 */
export function DeleteExpenseForm({ id }: { id: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(t("expenses.delete_confirm"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t("expenses.delete_failed"));
        return;
      }
      router.push("/expenses");
    } catch {
      setError(t("common.network_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="text-rose-600 text-sm underline disabled:opacity-60"
      >
        {busy ? t("common.deleting") : t("expenses.delete")}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-600 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
