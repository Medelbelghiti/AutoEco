import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { env } from "./env";
import type { User } from "@prisma/client";

// Production safety audit is run lazily inside `requireUser()` so that
// build-time page data collection does not abort if env vars are missing
// in development.

const SESSION_COOKIE = "lg_session";
const SESSION_DAYS = 30;

function secretKey(): Uint8Array {
  if (!env.authSecret) {
    throw new Error("AUTH_SECRET is not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and add it to your environment.");
  }
  return new TextEncoder().encode(env.authSecret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string, sessionVersion?: number): Promise<void> {
  let sv = sessionVersion;
  if (sv === undefined) {
    const row = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
    sv = row?.sessionVersion ?? 0;
  }
  const token = await new SignJWT({ sub: userId, sv })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function destroySession(): void {
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

async function readSession(): Promise<{ userId: string; sv: number } | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string") return null;
    // Tokens issued before sessionVersion existed carry no `sv` => 0.
    const sv = typeof payload.sv === "number" ? payload.sv : 0;
    return { userId: payload.sub, sv };
  } catch {
    return null;
  }
}

export async function getSessionUserId(): Promise<string | null> {
  return (await readSession())?.userId ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await readSession();
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || user.deletedAt) return null;
  // Revoked session: password was changed/reset after this token was issued.
  if ((user.sessionVersion ?? 0) !== session.sv) return null;
  return user;
}

// Production safety audit runs lazily on the first protected request.
let _prodAsserted = false;

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED", "Authentication required");
  if (!_prodAsserted) {
    _prodAsserted = true;
    try {
      const { assertProdOnBoot } = await import("./env");
      assertProdOnBoot();
    } catch (e) {
      // Re-throw so the request fails closed.
      _prodAsserted = false;
      throw e;
    }
  }
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("FORBIDDEN", "Admin access required");
  return user;
}

export class AuthError extends Error {
  code: "UNAUTHENTICATED" | "FORBIDDEN";
  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
    this.code = code;
  }
}

/** Verify the caller owns the resource (tenant isolation / IDOR guard). */
export function assertOwnership(resourceUserId: string, user: User): void {
  if (resourceUserId !== user.id && user.role !== "ADMIN") {
    throw new AuthError("FORBIDDEN", "You do not have access to this resource");
  }
}
