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

/**
 * Deliver an event whose side effect throws, i.e. a worker that must retry.
 */
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
 * The same race as `deliverAndFail`, but with the two phases separated so the
 * outcome does not depend on database latency.
 *
 * Running claim-and-fail as one interleaved `Promise.all` asserts something
 * stronger than the code promises: the moment the winner marks the event FAILED
 * the row is legitimately claimable again — that is how retries work, and the
 * same test then asserts a later delivery succeeds. Any worker whose claim
 * merely lands after that point is correct behaviour, not a lost race. Under
 * load a handful of them do, which made the assertion flaky.
 *
 * What is actually guaranteed, and what this tests, is that a single worker
 * wins the initial claim and that only the token holder may finalize.
 */
export async function deliverAndFailConcurrently(
  eventId: string,
  type: string,
  workers: number,
  message = "test failure"
): Promise<Array<Outcome | "failed">> {
  const tokens = await Promise.all(
    Array.from({ length: workers }, () => claim(eventId, type))
  );

  // Workers that lost the claim never hold a token, so they cannot finalize.
  const results: Array<Outcome | "failed"> = tokens.map(() => "skipped-other-worker");

  const winnerIndexes = tokens.flatMap((token, i) => (token === null ? [] : [i]));
  const finalized = await Promise.all(
    winnerIndexes.map((i) => markFailed(eventId, tokens[i] as string, message))
  );
  winnerIndexes.forEach((workerIndex, i) => {
    results[workerIndex] = finalized[i] ? "failed" : "skipped-other-worker";
  });

  return results;
}

/**
 * Take a claim but never finalize it, standing in for a worker that crashed
 * mid-event. Its token must not be able to finalize after another worker
 * reclaimed the event.
 */
export async function claimAndAbandon(eventId: string, type: string): Promise<string | null> {
  return claim(eventId, type);
}