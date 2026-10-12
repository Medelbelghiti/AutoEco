import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { AuthError } from "./auth";
import { RateLimitError } from "./rate-limit";
import { BillingNotConfiguredError } from "./billing-errors";
import { CurrencyMismatchError } from "./finance";
import { getClientIp } from "./utils";
import { auditLog } from "./audit";
import crypto from "crypto";

export type Handler<T = unknown> = (req: Request, ctx: T) => Promise<Response | NextResponse>;

function referenceId(): string {
  return "ref_" + crypto.randomBytes(6).toString("hex");
}

/**
 * Wraps a route handler with strict error handling.
 *
 * Rules:
 *   - Internal / unexpected errors are NEVER sent to the client verbatim.
 *     They are logged server-side with a unique referenceId; the client
 *     receives only "Something went wrong. Reference: ref_xxx" so a support
 *     engineer can find the underlying log.
 *   - Zod validation errors ARE safe to expose (field-level details).
 *   - Domain errors with user-safe messages (AuthError, RateLimitError,
 *     BillingNotConfiguredError, CurrencyMismatchError) are exposed as-is.
 */
export function withErrorHandling<T = unknown>(handler: Handler<T>): Handler<T> {
  return async (req: Request, ctx: T) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      const ref = referenceId();

      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid input", issues: e.flatten(), referenceId: ref },
          { status: 400 }
        );
      }
      if (e instanceof AuthError) {
        return NextResponse.json(
          { error: e.message, referenceId: ref },
          { status: e.code === "UNAUTHENTICATED" ? 401 : 403 }
        );
      }
      if (e instanceof RateLimitError) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later.", referenceId: ref },
          { status: 429 }
        );
      }
      if (e instanceof BillingNotConfiguredError) {
        return NextResponse.json(
          { error: "Billing is not configured on this server.", code: "BILLING_NOT_CONFIGURED", referenceId: ref },
          { status: 503 }
        );
      }
      if (e instanceof CurrencyMismatchError) {
        return NextResponse.json(
          {
            error: "Cannot compute totals: mixed currencies detected in your data. Please ensure all entries use the same currency.",
            code: "MIXED_CURRENCY",
            currencies: e.currencies,
            referenceId: ref,
          },
          { status: 422 }
        );
      }

      // UNEXPECTED — log server-side, return generic message + referenceId
      const ip = getClientIp(req);
      const message = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      await auditLog({
        action: "api.error",
        metadata: { referenceId: ref, message, stack },
        ip,
      }).catch(() => {});
      // eslint-disable-next-line no-console
      console.error(`[${ref}] API error:`, e);
      return NextResponse.json(
        { error: "Something went wrong. Please try again.", referenceId: ref },
        { status: 500 }
      );
    }
  };
}

export async function parseJson<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  const body = await req.json().catch(() => ({}));
  return schema.parse(body) as T;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
