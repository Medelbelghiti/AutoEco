/**
 * Shared guard for `/api/cron/*` routes.
 *
 * Vercel Cron invokes these with `Authorization: Bearer $CRON_SECRET`.
 * The check is constant-time. When `CRON_SECRET` is unset the route refuses
 * to run rather than becoming an unauthenticated trigger — an open cron
 * endpoint that sends email or deletes rows is worse than a disabled one.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";

export function cronSecret(): string {
  return process.env.CRON_SECRET ?? "";
}

export function cronConfigured(): boolean {
  return cronSecret().length >= 16;
}

/**
 * Returns a 401/503 response when the request is not an authorised cron
 * invocation, or `null` when the caller may proceed.
 */
export async function verifyCronRequest(req: Request): Promise<NextResponse | null> {
  const secret = cronSecret();

  if (!secret) {
    await auditLog({ action: "cron.secret_missing" }).catch(() => {});
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Set it in your Vercel project to enable cron jobs." },
      { status: 503 }
    );
  }
  if (secret.length < 16) {
    return NextResponse.json(
      { error: "CRON_SECRET is too short to be safe. Use at least 16 characters." },
      { status: 503 }
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);

  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    await auditLog({ action: "cron.unauthorized", ip: clientIp(req) }).catch(() => {});
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function clientIp(req: Request): string | undefined {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim();
  return req.headers.get("x-real-ip") ?? undefined;
}