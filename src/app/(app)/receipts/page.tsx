import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { translateEnum } from "@/lib/i18n";
import { getT } from "@/lib/server-i18n";
import { ReceiptDeleteForm } from "@/components/receipts/ReceiptDeleteForm";

const RECEIPT_CATEGORIES = ["fuel", "maintenance", "repair", "insurance", "parking", "tolls", "other"];

export default async function ReceiptsPage() {
  const user = await requireUser();
  const t = getT();
  const docs = await db.document.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false } });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t("nav.receipts")}</h1>
      <p className="text-sm text-charcoal-500">{t("receipts.subtitle")}</p>

      {vehicles.length === 0 ? (
        <div className="card text-center">
          <p className="font-semibold">{t("receipts.needs_vehicle_title")}</p>
          <Link href="/garage/new" className="btn btn-accent mt-3 inline-flex">{t("common.add_vehicle")}</Link>
        </div>
      ) : (
        <div className="card">
          <p className="font-semibold">{t("receipts.upload_title")}</p>
          <form action="/api/receipts" method="post" encType="multipart/form-data" className="mt-3 space-y-3 text-sm">
            <div>
              <label className="label">{t("common.vehicle")}</label>
              <select name="vehicleId" className="select" required>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.nickname ?? (v.year + " " + v.brand + " " + v.model)}</option>)}
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
            <button type="submit" className="btn btn-accent">{t("receipts.upload_extract")}</button>
          </form>
          <p className="text-xs text-charcoal-500 mt-3">{t("receipts.private_note")}</p>
        </div>
      )}

      <div className="card">
        <p className="font-semibold">{t("receipts.your_receipts")}</p>
        {docs.length === 0 ? <p className="text-sm text-charcoal-500 mt-2">{t("receipts.empty")}</p> : (
<div className="overflow-x-auto mt-3">
            <table className="basic">
              <thead><tr><th>{t("receipts.title_col")}</th><th>{t("common.category")}</th><th>{t("receipts.size_col")}</th><th>{t("receipts.uploaded_col")}</th><th></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><a className="underline" href={"/api/documents/" + d.id} target="_blank" rel="noopener">{d.title}</a></td>
                    <td className="capitalize">{translateEnum(t, "category.", d.category)}</td>
                    <td>{(d.sizeBytes / 1024).toFixed(0)} KB</td>
                    <td>{d.createdAt.toISOString().slice(0, 10)}</td>
                    <td>
                      <ReceiptDeleteForm id={d.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}