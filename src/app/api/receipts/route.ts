import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveFile, deleteFile, validateUpload, storageIsPersistent, bytesMatchMime } from "@/lib/storage";
import { getOcrProvider } from "@/lib/ocr";
import { ALLOWED_CATEGORIES, normalizeCategory } from "@/lib/finance";
import { getEntitlements } from "@/lib/plans";
import { buildPeriodKey, tryConsume, release } from "@/lib/quota";

export const GET = withErrorHandling(async () => {
  const user = await requireUser();
  const docs = await db.document.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return ok({ documents: docs, ocrAvailable: getOcrProvider().available });
});

const ALLOWED_CATEGORY_SET = new Set<string>(ALLOWED_CATEGORIES);

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const form = await req.formData();
  const file = form.get("file");
  const vehicleIdRaw = form.get("vehicleId");
  const titleRaw = form.get("title");
  const categoryRaw = (form.get("category") as string | null) ?? "other";
  const category = ALLOWED_CATEGORY_SET.has(categoryRaw) ? categoryRaw : "other";
  void normalizeCategory;

  // 1. File validation (rejects BEFORE quota consumption).
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  const err = validateUpload(file);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const head = Buffer.from(await file.slice(0, 16).arrayBuffer());
  if (!bytesMatchMime(head, file.type)) {
    return NextResponse.json({ error: "File content does not match its declared type" }, { status: 400 });
  }
  if (!storageIsPersistent()) {
    return NextResponse.json(
      { error: "Receipt storage is not configured on this server yet.", code: "STORAGE_UNAVAILABLE" },
      { status: 503 }
    );
  }

  // 2. Vehicle ownership check.
  const vehicleId = typeof vehicleIdRaw === "string" ? vehicleIdRaw : null;
  if (vehicleId) {
    const v = await db.vehicle.findUnique({ where: { id: vehicleId } });
    if (!v || v.userId !== user.id) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  // 3. Authoritative entitlement.
  const ent = await getEntitlements(user);
  const periodKey = buildPeriodKey(new Date(), { trial: ent.isTrial, userId: user.id });
  const ocrAvailable = getOcrProvider().available;

  // 4. Atomic quota reservation. Only run if OCR is actually available.
  let reserved = false;
  if (ocrAvailable) {
    const r = await tryConsume({
      userId: user.id,
      metric: "ocr_scans",
      periodKey,
      limit: ent.aiReceiptScansPerMonth,
    });
    if (!r.allowed) {
      return NextResponse.json(
        {
          error: ent.aiReceiptScansPerMonth === 0
            ? "Receipt scanning is not included in your plan"
            : `Monthly OCR limit reached (${ent.aiReceiptScansPerMonth})`,
          code: "OCR_QUOTA_EXCEEDED",
        },
        { status: 403 }
      );
    }
    reserved = true;
  }

  // 5–7. File write + OCR + DB persist with full rollback on any failure.
  //
  // Guarantees:
  //   - file is deleted on OCR or DB failure
  //   - quota is released exactly once on any failure
  //   - on success, both stay consumed and persisted
  //
  // A "release" / "delete" never runs after the final OK response.
  let stored: { storageKey: string; sizeBytes: number } | null = null;
  try {
    // 5. Save file
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
    const prefix = vehicleId ? `receipts/${vehicleId}` : `receipts/user/${user.id}`;
    stored = await saveFile(prefix, ext, bytes);

    // 6. Run OCR
    const ocr = await getOcrProvider().extract({ bytes, mimeType: file.type });

    // 7. Persist document
    const title = typeof titleRaw === "string" && titleRaw.length > 0 ? titleRaw : (file.name || "Receipt");
    const doc = await db.document.create({
      data: {
        userId: user.id, vehicleId, title, category,
        storageKey: stored.storageKey, mimeType: file.type, sizeBytes: stored.sizeBytes,
      },
    });

    // SUCCESS — return without touching quota or file
    return ok({ document: doc, ocr, ocrAvailable, message: ocr.status === "unavailable" ? ocr.message : undefined });
  } catch (e) {
    // FAILURE — release both quota and file exactly once.
    if (stored) {
      try { await deleteFile(stored.storageKey); } catch { /* idempotent */ }
    }
    if (reserved) {
      try { await release({ userId: user.id, metric: "ocr_scans", periodKey }); } catch { /* idempotent */ }
    }
    throw e;
  }
});
