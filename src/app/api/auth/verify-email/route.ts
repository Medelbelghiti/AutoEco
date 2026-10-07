import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { VerifyEmailSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/utils";
import { auditLog } from "@/lib/audit";

export const POST = withErrorHandling(async (req) => {
  const { token } = await parseJson(req, VerifyEmailSchema);
  const tokenHash = sha256(token);
  const row = await db.verificationToken.findUnique({ where: { tokenHash } });
  if (!row || row.type !== "VERIFY_EMAIL" || row.usedAt || row.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Invalid or expired token", code: "AUTH_INVALID_TOKEN" },
      { status: 400 }
    );
  }
  await db.user.update({
    where: { id: row.userId },
    data: { emailVerifiedAt: new Date() },
  });
  await db.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  await auditLog({ userId: row.userId, action: "email.verified" });
  return ok({ ok: true });
});
