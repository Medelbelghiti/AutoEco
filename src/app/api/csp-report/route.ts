/**
 * POST /api/csp-report — sink for Content-Security-Policy violation reports.
 *
 * Referenced by `report-uri /api/csp-report` and by the `Reporting-Endpoints`
 * header in `next.config.mjs`. While the policy ships as Report-Only, this
 * endpoint is how you find out whether flipping it to enforcing would break
 * Paddle checkout, Turnstile, or the Next.js inline scripts.
 *
 * Only report CONTENT is logged. The body is attacker-controlled, so it is
 * truncated and never reflected back in the response.
 */
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { captureEvent } from "@/lib/error-capture";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  // Unauthenticated write endpoint: without a limit, anyone could spam reports
  // and fill the audit log. Reports arrive in bursts from one page load, so the
  // ceiling is generous.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit({ key: `csp:${ip}`, limit: 60, windowSeconds: 60 });
  if (!rl.allowed) return new NextResponse(null, { status: 429 });

  let raw = "";
  try {
    raw = (await req.text()).slice(0, 4096);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // `"csp-endpoint"` from the Reporting API, or a bare report-uri payload.
  let type = "unknown";
  let body = raw;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/csp-report")) {
    type = "csp-report";
  } else if (contentType.includes("application/reports+json")) {
    type = "reporting-api";
    try {
      const parsed = JSON.parse(raw) as Array<{ type?: string; body?: unknown }>;
      if (Array.isArray(parsed) && parsed[0]?.type === "csp-violation") type = "csp-violation";
    } catch {
      type = "reporting-api-unparsable";
    }
  }

  const entry = `[csp-report] type=${type} body=${body}`;
  if (type === "unknown" || type === "reporting-api-unparsable") {
    // eslint-disable-next-line no-console
    console.warn(entry);
    return new NextResponse(null, { status: 204 });
  }

  // Routed through the error-capture seam rather than written directly, so a
  // violation reaches the audit log and Sentry through one code path. The
  // message is truncated and email-scrubbed there.
  await captureEvent(
    { message: entry, level: "warning" },
    { scope: "csp.violation", extra: { ip: ip === "unknown" ? undefined : ip } }
  );

  return new NextResponse(null, { status: 204 });
}