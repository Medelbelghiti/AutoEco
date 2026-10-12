/**
 * POST /api/track
 *
 * Public, privacy-preserving funnel tracking for anonymous visitors.
 *
 * Threat model / constraints:
 *  - The event name is allowlisted. A caller cannot invent arbitrary event
 *    names or attach arbitrary payloads.
 *  - No IP, no user agent, no cookie identifier and no session id is stored.
 *    A random per-browser id lives only in the caller's own storage (see
 *    `track()` in `src/lib/track-client.ts`), so we can count unique
 *    visitors without holding anything personal.
 *  - Rate limited per IP.
 *  - Always returns 204. Analytics must never break a page.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Only anonymous marketing/funnel events may be posted here. Anything that
 * identifies a user must go through a server-side route that calls
 * `trackEvent()` directly.
 */
const ALLOWED = [
  "landing_view",
  "cta_click",
  "calculator_started",
  "calculator_completed",
  "pricing_view",
  "signup_started",
  "docs_view",
] as const;

type AllowedEvent = (typeof ALLOWED)[number];

// Shared limiter (DB-backed). The previous in-memory Map was per serverless
// instance, so it limited nothing on Vercel. Analytics must never break a
// page, so any limiter failure is treated as "allowed".
async function rateLimited(key: string): Promise<boolean> {
  try {
    const r = await checkRateLimit({ key: `track:${key}`, limit: 60, windowSeconds: 60 });
    return !r.allowed;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip = getClientIp(req);

  if (await rateLimited(ip)) {
    return new NextResponse(null, { status: 204 });
  }

  let body: { event?: string; path?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (!body.event || !(ALLOWED as readonly string[]).includes(body.event)) {
    return new NextResponse(null, { status: 204 });
  }
  const event = body.event as AllowedEvent;

  // Only the path is accepted, and it is length-capped — never a free-form
  // payload, so this endpoint cannot be used as a generic data sink.
  const path = typeof body.path === "string" ? body.path.slice(0, 120) : null;

  try {
    await db.analyticsEvent.create({
      data: { userId: null, event, metadata: JSON.stringify({ path, anonymous: true }) },
    });
  } catch (e) {
    // Never surface a tracking failure to the caller — but DO record it. An
    // earlier version swallowed this silently, which made a total failure to
    // persist events invisible: the endpoint returned 204, the funnel looked
    // instrumented, and nothing was ever written.
    console.error(
      `[track] failed to persist ${event}:`,
      e instanceof Error ? e.message : e
    );
  }

  return new NextResponse(null, { status: 204 });
}

/** Expose the allowlist so the client helper cannot drift from the server. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ events: ALLOWED });
}