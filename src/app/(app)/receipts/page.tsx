import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { translateEnum } from "@/lib/i18n";
import { getT } from "@/lib/server-i18n";
import { ReceiptDeleteForm } from "@/components/receipts/ReceiptDeleteForm";
import { ReceiptUploadForm } from "@/components/receipts/ReceiptUploadForm";

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
          <ReceiptUploadForm
            vehicles={vehicles.map((v) => ({ id: v.id, label: v.nickname ?? `${v.year} ${v.brand} ${v.model}` }))}
          />
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