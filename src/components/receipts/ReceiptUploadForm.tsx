"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/LocaleProvider";
import { translateEnum } from "@/lib/i18n";

const RECEIPT_CATEGORIES = ["fuel", "maintenance", "repair", "insurance", "parking", "tolls", "other"];

/**
 * Upload a receipt.
 *
 * The form previously posted multipart data straight to `/api/receipts`, so a
 * success (or an error) navigated the user to a raw JSON body. It now submits
 * the same multipart form with `fetch`, keeps validation, quota and storage
 * behaviour on the server unchanged, and surfaces the outcome as translated
 * text on the page.
 */
export function ReceiptUploadForm({ vehicles }: { vehicles: { id: string; label: string }[] }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/receipts", { method: "POST", body: new FormData(form) });
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = ((await res.json()) as { code?: string }).code;
        } catch {
          // non-JSON error body — fall through to the generic message
        }
        if (code === "STORAGE_UNAVAILABLE" || res.status === 503) setError(t("receipts.error_storage"));
        else if (code === "OCR_QUOTA_EXCEEDED") setError(t("receipts.error_quota"));
        else setError(t("receipts.upload_failed"));
        return;
      }
      form.reset();
      setMessage(t("receipts.upload_success"));
      router.refresh();
    } catch {
      setError(t("common.network_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="mt-3 space-y-3 text-sm">
        <div>
          <label className="label">{t("common.vehicle")}</label>
          <select name="vehicleId" className="select" required>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("receipts.title_optional")}</label>
          <input className="input" name="title" placeholder={t("receipts.title_placeholder")} />
        </div>
        <div>
          <label className="label">{t("receipts.category_label")}</label>
          <select name="category" className="select">
            {RECEIPT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{translateEnum(t, "category.", c)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("receipts.file_label")}</label>
          <input className="input" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required />
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-emerald-600">{message}</p>}
        <button type="submit" className="btn btn-accent" disabled={busy}>
          {busy ? t("receipts.uploading") : t("receipts.upload_extract")}
        </button>
      </form>
      <p className="text-xs text-charcoal-500 mt-3">{t("receipts.private_note")}</p>
    </div>
  );
}
