"use client";

import { useT } from "@/components/LocaleProvider";

/**
 * Delete a receipt document.
 *
 * Confirmation runs in the browser, so the handler lives in a client
 * component; the POST-with-_method=DElETE convention is preserved.
 */
export function ReceiptDeleteForm({ id }: { id: string }) {
  const t = useT();
  return (
    <form
      action={`/api/documents/${id}`}
      method="post"
      onSubmit={(e) => {
        if (!confirm(t("receipts.delete_confirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="_method" value="DELETE" />
      <button type="submit" className="text-rose-600 text-xs underline">
        {t("receipts.delete")}
      </button>
    </form>
  );
}