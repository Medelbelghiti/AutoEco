/**
 * Webhook delivery harness.
 *
 * These tests used to call `handleStripeEvent` directly. Stripe was removed in
 * 2.2, and the exactly-once ownership guarantees being tested (one worker wins
 * a fresh claim, a stale worker holding the old token cannot finalize, retries
 * move FAILED → PROCESSED) live in `webhook-state`, not in a provider handler.
 *
 * This harness reproduces the claim → apply → finalize sequence that the Paddle
 * webhook route performs, so those guarantees stay covered against the real
 * primitives. The provider handler itself is covered end to end in
 * `tests/paddle.test.ts`.
 */
import { claim, reclaimStale, markProcessed, markFailed } from "@/lib/webhook-state";

export type Outcome = "applied" | "skipped-other-worker";

/** Deliver an event with a no-op side effect, i.e. a well-behaved worker. */
export async function deliverOnce(eventId: string, type: string): Promise<Outcome> {
  let token = await claim(eventId, type);
  if (token === null) {
    token = await reclaimStale(eventId);
    if (token === null) return "skipped-other-worker";
  }
  const finalized = await markProcessed(eventId, token);
  return finalized ? "applied" : "skipped-other-worker";
}

/** Deliver an event whose side effect throws, i.e. a worker that must retry. */
export async function deliverAndFail(
  eventId: string,
  type: string,
  message = "test failure"
): Promise<Outcome | "failed"> {
  let token = await claim(eventId, type);
  if (token === null) {
    token = await reclaimStale(eventId);
    if (token === null) return "skipped-other-worker";
  }
  const finalized = await markFailed(eventId, token, message);
  return finalized ? "failed" : "skipped-other-worker";
}

/**
 * Take a claim but never finalize it, standing in for a worker that crashed
 * mid-event. Its token must not be able to finalize after another worker
 * reclaimed the event.
 */
export async function claimAndAbandon(eventId: string, type: string): Promise<string | null> {
  return claim(eventId, type);
}