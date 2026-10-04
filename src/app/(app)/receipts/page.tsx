import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function ReceiptsPage() {
  const user = await requireUser();
  const docs = await db.document.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false } });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Receipts</h1>
      <p className="text-sm text-charcoal-500">Upload a receipt image or PDF. AutoEco extracts the relevant fields — you always confirm before saving.</p>

      {vehicles.length === 0 ? (
        <div className="card text-center">
          <p className="font-semibold">Add a vehicle first</p>
          <Link href="/garage/new" className="btn btn-accent mt-3 inline-flex">Add a vehicle</Link>
        </div>
      ) : (
        <div className="card">
          <p className="font-semibold">Upload a new receipt</p>
          <form action="/api/receipts" method="post" encType="multipart/form-data" className="mt-3 space-y-3 text-sm">
            <div>
              <label className="label">Vehicle</label>
              <select name="vehicleId" className="select" required>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.nickname ?? (v.year + " " + v.brand + " " + v.model)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Title (optional)</label>
              <input className="input" name="title" placeholder="Receipt title" />
            </div>
            <div>
              <label className="label">Suggested category</label>
              <select name="category" className="select">
                <option value="fuel">Fuel</option>
                <option value="maintenance">Maintenance</option>
                <option value="repair">Repair</option>
                <option value="insurance">Insurance</option>
                <option value="parking">Parking</option>
                <option value="tolls">Tolls</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Receipt file (image or PDF, max 10 MB)</label>
              <input className="input" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required />
            </div>
            <button type="submit" className="btn btn-accent">Upload and extract</button>
          </form>
          <p className="text-xs text-charcoal-500 mt-3">Receipts are private. After upload you will be shown the extracted fields and asked to confirm before an expense is created.</p>
        </div>
      )}

      <div className="card">
        <p className="font-semibold">Your receipts</p>
        {docs.length === 0 ? <p className="text-sm text-charcoal-500 mt-2">No receipts yet.</p> : (
<div className="overflow-x-auto mt-3">
            <table className="basic">
              <thead><tr><th>Title</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><a className="underline" href={"/api/documents/" + d.id} target="_blank" rel="noopener">{d.title}</a></td>
                    <td className="capitalize">{d.category}</td>
                    <td>{(d.sizeBytes / 1024).toFixed(0)} KB</td>
                    <td>{d.createdAt.toISOString().slice(0, 10)}</td>
                    <td>
                      <form action={"/api/documents/" + d.id} method="post" onSubmit={(e) => { if (!confirm("Delete this receipt?")) e.preventDefault(); }}>
                        <input type="hidden" name="_method" value="DELETE" />
                        <button type="submit" className="text-rose-600 text-xs underline">Delete</button>
                      </form>
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
