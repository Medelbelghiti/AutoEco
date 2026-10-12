/**
 * Session cookie names, shared by the Node runtime (`src/lib/auth.ts`) and the
 * Edge middleware (`src/middleware.ts`).
 *
 * The cookie was `lg_session`, a leftover from the product's previous name
 * ("LeadGen"). It is renamed to `autoeco_session` for one release, with the
 * old name still accepted on read so nobody is logged out by the deploy.
 *
 * This module deliberately has no imports: the Edge runtime cannot pull in
 * `next/headers` or Prisma.
 */
export const SESSION_COOKIE = "autoeco_session";

/** Kept readable for one release, then dropped. */
export const LEGACY_SESSION_COOKIE = "lg_session";

export const SESSION_COOKIE_NAMES = [SESSION_COOKIE, LEGACY_SESSION_COOKIE] as const;