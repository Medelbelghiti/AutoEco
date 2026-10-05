import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/http";
import { requireUser, assertOwnership } from "@/lib/auth";
import { db } from "@/lib/db";
import { readFile, deleteFile } from "@/lib/storage";

export const GET = withErrorHandling(async (_req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const { id } = ctx.params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(doc.userId, user);
  const buf = await readFile(doc.storageKey);
  return new NextResponse(buf as BodyInit, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": "inline; filename=\"" + encodeURIComponent(doc.title) + "\"",
      "Cache-Control": "private, no-store",
      // Uploaded content must never execute in our origin.
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: { params: { id: string } }) => {
  const user = await requireUser();
  const { id } = ctx.params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertOwnership(doc.userId, user);
  await deleteFile(doc.storageKey);
  await db.document.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
