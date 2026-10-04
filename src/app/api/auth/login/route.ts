import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { LoginSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/utils";
import { auditLog } from "@/lib/audit";
import { trackEvent } from "@/lib/analytics";

export const POST = withErrorHandling(async (req) => {
  const ip = getClientIp(req);
  const rl = await checkRateLimit({ key: `login:${ip}`, limit: 20, windowSeconds: 600 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });

  const body = await parseJson(req, LoginSchema);
  const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user || user.deletedAt) {
    await auditLog({ action: "login.failed", metadata: { email: body.email }, ip });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json(
      { error: "Account temporarily locked due to failed attempts" },
      { status: 423 }
    );
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });
    await auditLog({ userId: user.id, action: "login.failed", ip });
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id);
  await auditLog({ userId: user.id, action: "login.success", ip });
  await trackEvent("login", { userId: user.id });

  return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});
