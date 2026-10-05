import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { ForgotPasswordSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/utils";
import { sendEmail, tplPasswordReset } from "@/lib/email";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/utils";

export const POST = withErrorHandling(async (req) => {
  const ip = getClientIp(req);
  const { email } = await parseJson(req, ForgotPasswordSchema);
  // Two buckets: per IP (spray) and per target mailbox (email bombing).
  // Both answer 200 so the response never reveals whether an account exists.
  const byIp = await checkRateLimit({ key: `forgot:ip:${ip}`, limit: 10, windowSeconds: 3600 });
  const byEmail = await checkRateLimit({ key: `forgot:email:${email.toLowerCase()}`, limit: 3, windowSeconds: 3600 });
  if (!byIp.allowed || !byEmail.allowed) return ok({ ok: true });
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  // Always return 200 to avoid revealing whether the email exists
  if (user && !user.deletedAt) {
    const token = randomToken(24);
    await db.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        type: "PASSWORD_RESET",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const link = `${env.appUrl}/reset-password?token=${token}`;
    await sendEmail({ ...tplPasswordReset(user.name, link), to: user.email });
  }
  return ok({ ok: true });
});
