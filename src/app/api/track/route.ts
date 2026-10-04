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
import { auditLog } from "@/lib/audit";

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

// Simple in-process limiter. Good enough to blunt casual abuse; the database
// is the source of truth for real analysis.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_PER_WINDOW;
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
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
  } catch {
    // Never surface a tracking failure.
  }

  return new NextResponse(null, { status: 204 });
}

/** Expose the allowlist so the client helper cannot drift from the server. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ events: ALLOWED });
}