"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/LocaleProvider";

/**
 * Delete a receipt document.
 *
 * Confirmation runs in the browser and the deletion is a real `DELETE`
 * request, so a failed request shows a translated message instead of
 * navigating the user to a raw JSON body (the route exports no POST and there
 * is no `_method` override).
 */
export function ReceiptDeleteForm({ id }: { id: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(t("receipts.delete_confirm"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t("receipts.delete_failed"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("common.network_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="text-rose-600 text-xs underline disabled:opacity-60"
      >
        {busy ? t("common.deleting") : t("receipts.delete")}
      </button>
      {error && (
        <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
