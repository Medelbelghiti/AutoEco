/**
 * Webhook state machine + side-effect idempotency.
 *
 * This module is provider-neutral. Both the Stripe webhook handler and
 * the Lemon Squeezy webhook handler use these primitives to guarantee:
 *
 *   - at-most-once execution of business effects under concurrency
 *   - durable side-effect idempotency (notifications, emails) per event
 *   - safe retry handling (FAILED → PROCESSING)
 *   - safe stale-recovery (PROCESSING > 15min → reclaimable)
 *   - ownership-bound finalization (a stale worker cannot mark
 *     PROCESSED/FAILED after losing the processingToken to a new
 *     claim)
 *
 * DO NOT change the SQL patterns without also changing:
 *   - tests/final-3-blockers.test.ts
 *   - prisma/schema.prisma (WebhookEvent, WebhookSideEffect)
 *   - the production audit doc
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";

export type WebhookStatus = "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED";

const STALE_PROCESSING_MINUTES = 15;

function newProcessingToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Atomically transition an event into PROCESSING with a fresh
 * processingToken. Returns the new token if THIS call won the claim,
 * otherwise null.
 */
export async function claim(eventId: string, type: string): Promise<string | null> {
  await db.$executeRaw(
    Prisma.sql`INSERT INTO "WebhookEvent" ("id","eventId","type","status","attempts","processingToken","createdAt","updatedAt")
     VALUES (${`wh_${eventId}`}, ${eventId}, ${type}, ${"RECEIVED"}, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("eventId") DO NOTHING`
  ).catch(() => 0);
  const token = newProcessingToken();
  const result = await db.webhookEvent.updateMany({
    where: { eventId, status: { in: ["RECEIVED", "FAILED"] } },
    data: { status: "PROCESSING", processingToken: token, attempts: { increment: 1 } },
  });
  return result.count > 0 ? token : null;
}

/** Stale-PENDING recovery: re-claim a row stuck in PROCESSING. */
export async function reclaimStale(eventId: string): Promise<string | null> {
  const threshold = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);
  const token = newProcessingToken();
  const result = await db.webhookEvent.updateMany({
    where: { eventId, status: "PROCESSING", updatedAt: { lt: threshold } },
    data: { status: "PROCESSING", processingToken: token, attempts: { increment: 1 }, error: "stale PROCESSING reclaimed" },
  });
  if (result.count === 0) return null;
  // Force updatedAt to advance (Prisma @updatedAt does not auto-advance
  // on a no-op update).
  await db.webhookEvent.update({ where: { eventId }, data: {} }).catch(() => {});
  return token;
}

/** Token-bound finalization. Returns false if our token has been rotated. */
export async function markProcessed(eventId: string, token: string): Promise<boolean> {
  const r = await db.webhookEvent.updateMany({
    where: { eventId, status: "PROCESSING", processingToken: token },
    data: { status: "PROCESSED", processedAt: new Date(), error: null },
  });
  return r.count > 0;
}

export async function markFailed(eventId: string, token: string, message: string): Promise<boolean> {
  const r = await db.webhookEvent.updateMany({
    where: { eventId, status: "PROCESSING", processingToken: token },
    data: { status: "FAILED", error: message.slice(0, 1000) },
  });
  return r.count > 0;
}

/**
 * Durable side-effect idempotency. The first caller to successfully
 * INSERT wins; concurrent callers see P2002 and return false. Retry /
 * stale-recovery / concurrent deliveries never duplicate an effect.
 */
export async function tryClaimSideEffect(
  eventId: string,
  effectType: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  try {
    await db.webhookSideEffect.create({
      data: { eventId, effectType, metadata: metadata ? JSON.stringify(metadata) : null },
    });
    return true;
  } catch (e: any) {
    if (e?.code === "P2002" || /Unique constraint/i.test(String(e?.message ?? ""))) {
      return false;
    }
    throw e;
  }
}
