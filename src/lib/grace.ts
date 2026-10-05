/** Pure helpers (no DB import) so they can be unit-tested anywhere. */
export const PAST_DUE_GRACE_DAYS = 14;

/**
 * Is a `past_due` subscription still inside its dunning grace window?
 * Grace runs for PAST_DUE_GRACE_DAYS AFTER the paid period ended (or after the
 * last update when no period end is known).
 */
export function isPastDueGraceActive(periodEnd: Date | null, updatedAt: Date, now: Date = new Date()): boolean {
  const anchor = periodEnd ?? updatedAt;
  return anchor.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000 > now.getTime();
}
