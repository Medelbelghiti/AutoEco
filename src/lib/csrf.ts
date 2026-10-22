/**
 * Same-origin check for state-changing requests.
 *
 * This is a defence-in-depth layer on top of the `SameSite=Lax` session
 * cookie, which already stops the classic cross-site form POST. It closes the
 * remaining gap (older browsers, and any future cookie loosening) without
 * requiring a token round-trip on every write.
 *
 * Deliberate behaviour:
 *
 *   - Only "unsafe" methods are inspected. GET/HEAD/OPTIONS can never mutate.
 *   - A request with NO `Origin` header is allowed: that is not a
 *     browser-initiated cross-site write — it is a server-to-server webhook
 *     (Paddle, PayPal), a cron job or curl. Those are authenticated by
 *     signature/secret, not by the browser, and would otherwise all break.
 *   - An `Origin` whose host differs from the requested host is refused. A
 *     malformed origin (including the literal `null` emitted by sandboxed
 *     iframes) is treated as cross-origin and refused.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * True when a write request is being made from another origin.
 *
 * `originHeader` / `hostHeader` are raw header values (or null when absent).
 */
export function isCrossOriginWrite(
  method: string,
  originHeader: string | null,
  hostHeader: string | null
): boolean {
  if (isSafeMethod(method)) return false;
  if (!originHeader) return false;
  // Without a Host header we cannot decide; fail open so we never brick the
  // API for an infrastructure that strips it (the session cookie and
  // route-level auth still apply).
  if (!hostHeader) return false;

  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    // Includes the literal "null" from sandboxed contexts.
    return true;
  }
  return originHost !== hostHeader;
}
