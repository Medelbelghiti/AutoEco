import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  coerceLocale,
  translator,
  type Locale,
  type Translate,
} from "@/lib/i18n";

export const LOCALE_COOKIE = "lg_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The locale for the current request.
 *
 * The cookie is the rendering source because it costs nothing: reading the
 * profile on every render would put a database round-trip in front of every
 * page, including the marketing pages a logged-out visitor loads first. The
 * profile is the durable copy and is written at the same time as the cookie
 * (settings form and the locale switcher both do this), so a signed-in user
 * keeps their choice across devices from their next sign-in, while a visitor's
 * choice lives in the cookie alone.
 *
 * Unknown or legacy cookie values fall back to English rather than throwing.
 */
export function getLocale(): Locale {
  return coerceLocale(cookies().get(LOCALE_COOKIE)?.value);
}

/** A `t` function bound to the request's locale, for server components. */
export function getT(): Translate {
  return translator(getLocale());
}

/**
 * The `Set-Cookie` value that mirrors a stored locale into the browser.
 *
 * A preference that only lives in the profile does not follow somebody to a
 * second device until they sign in there, so both auth paths write the cookie
 * at the same time as the session. After that the cookie alone decides what
 * the interface renders in, which keeps every read off the database.
 */
export function localeCookieHeader(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
