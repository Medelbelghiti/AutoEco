import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { LoginSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/utils";
import { auditLog } from "@/lib/audit";
import { trackEvent } from "@/lib/analytics";

/** One message for every failure mode, so none of them is a lookup oracle. */
const GENERIC_AUTH_ERROR = "Invalid email or password";

/**
 * A real bcrypt hash of a value nobody can supply, used only to spend the same
 * CPU on an unknown address. Generated from a throwaway secret.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7DKQ7CxSbLuKQpFWTVtL0zwsO6PbCLu";

export const POST = withErrorHandling(async (req) => {
  const ip = getClientIp(req);
  const rl = await checkRateLimit({ key: `login:${ip}`, limit: 20, windowSeconds: 600 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });

  const body = await parseJson(req, LoginSchema);
  const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });

  // Constant-ish work for an unknown address: without this, the "no such user"
  // branch returns before bcrypt runs and the response time alone reveals which
  // addresses are registered.
  if (!user || user.deletedAt) {
    await verifyPassword(body.password, DUMMY_HASH);
    await auditLog({ action: "login.failed", metadata: { email: body.email }, ip });
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  // A locked account must be indistinguishable from a wrong password: the
  // distinct 423 told an attacker the address exists *and* that it was locked.
  // The lockout itself is untouched.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await auditLog({ action: "login.locked", metadata: { email: body.email }, ip });
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
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
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id, user.sessionVersion);
  await auditLog({ userId: user.id, action: "login.success", ip });
  await trackEvent("login", { userId: user.id });

  return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});
