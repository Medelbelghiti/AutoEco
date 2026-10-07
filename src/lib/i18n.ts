import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import es from "@/locales/es.json";
import ptBR from "@/locales/pt-BR.json";
import de from "@/locales/de.json";
import ar from "@/locales/ar.json";

/**
 * Every locale the product offers.
 *
 * The list is the single source of truth for three things that used to drift
 * apart: this type, the signup schema and the profile schema. Keeping them
 * derived from one array is what stops a user from being able to store a
 * locale the app cannot then read back.
 *
 * `ar` is offered as a locale but the PDF cannot render it (see
 * `canPdfRender` in report-pdf.ts) and its RTL layout lands separately.
 */
export const LOCALES = ["en", "fr", "es", "pt-BR", "de", "ar"] as const;

export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Which locales are safe to ship right now.
 *
 * `ready` means every key in `en.json` has a real translation (see
 * `tests/i18n.test.ts`) and the locale can be picked in the UI. `pending`
 * means the copy is not native-quality yet (or, for `ar`, RTL is still
 * landing in a later change); a pending locale is never offered in selectors
 * and any direct URL or cookie for it degrades to English.
 */
export const LOCALE_STATUS: Record<Locale, "ready" | "pending"> = {
  en: "ready",
  fr: "ready",
  es: "ready",
  "pt-BR": "ready",
  de: "ready",
  ar: "pending",
};

export const READY_LOCALES: readonly Locale[] = LOCALES.filter(
  (l) => LOCALE_STATUS[l] === "ready"
);

export function isLocaleStatus(locale: Locale, status: "ready" | "pending"): boolean {
  return LOCALE_STATUS[locale] === status;
}

/**
 * Endonyms: each language is named the way its own speakers write it, which
 * is what somebody who cannot read the current interface needs in order to
 * find their way out of it. They are therefore never translated.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  de: "Deutsch",
  ar: "العربية",
};

/**
 * The locale we actually render with.
 *
 * A pending locale (or a valid locale whose copy is not production-ready)
 * renders English instead. This is what makes "direct URL/cookie for a
 * pending locale" fall back to English without crashing.
 */
export function effectiveLocale(locale: Locale): Locale {
  return isLocaleStatus(locale, "ready") ? locale : DEFAULT_LOCALE;
}

const dictionaries: Record<Locale, Record<string, string>> = {
  en,
  fr,
  es,
  "pt-BR": ptBR,
  de,
  ar,
};

export function isLocale(v: string | undefined | null): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Turn whatever is stored or supplied into a locale we can actually render.
 *
 * The database column is a free-form string and older rows (and hand-edited
 * cookies) carry values like `pt`, `de-DE` or `ar-SA`. Those must degrade to
 * `en` rather than reach `dictionaries[...]` and blow up a page.
 */
export function coerceLocale(v: string | undefined | null): Locale {
  if (isLocale(v)) return v;
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower === "pt" || lower.startsWith("pt-")) return "pt-BR";
    const base = lower.split("-")[0];
    const match = LOCALES.find((l) => l.toLowerCase() === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Record<string, string> {
  return dictionaries[effectiveLocale(locale)] ?? dictionaries[DEFAULT_LOCALE];
}

/** `{name}` placeholders are replaced from `params`; unknown ones are left as-is. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  );
}

/**
 * Look a key up in the requested locale, then in English.
 *
 * A key that exists in `en.json` but is missing from a translation shows
 * English instead of a raw dotted key. A key missing from English itself
 * (`dictionaries[DEFAULT_LOCALE]`) renders an empty string rather than the
 * key name: `tests/i18n.test.ts` fails the build for that case, so this only
 * ever happens in development.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = getDictionary(locale);
  const template = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? "";
  return interpolate(template, params);
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A `t` function bound to one locale, for passing around. */
export function translator(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

/**
 * Translate a value drawn from a fixed set (a status, a role) and leave the
 * stored value alone when there is no key for it.
 *
 * This is what keeps an unknown status from rendering as `status.something`
 * in the interface: the raw value is still legible, just untranslated.
 * A defined English key is required for a translated value to exist at all.
 */
export function translateEnum(t: Translate, prefix: string, value: string): string {
  const key = `${prefix}${value.toLowerCase()}`;
  if (dictionaries[DEFAULT_LOCALE][key] === undefined) return value;
  const out = t(key);
  return out === "" ? value : out;
}

/**
 * Plural clause for a count in a given language.
 *
 * Bundled dicts are flat and locale-shared, so they cannot carry
 * plural-variant keys. For the four shipped languages this picks the
 * right `Intl.PluralRules` category (English/German/Spanish use
 * `one`/`other`, French also has `many` at play in some numeric strings via
 * its own rules, Portuguese does not) and the caller supplies per-form text,
 * e.g. `plural(locale, n, "{count} entry", "{count} entries")`.
 */
export function plural(
  locale: Locale,
  count: number,
  one: string,
  other: string,
  many?: string
): string {
  const eff = effectiveLocale(locale);
  const rule = new Intl.PluralRules(intlLocale(eff)).select(count);
  if (rule === "one") return one;
  if (rule === "many" && many !== undefined) return many;
  return other;
}

/**
 * Layout direction for a locale.
 *
 * Right-to-left for Arabic is held out of this change: `ar` is a `pending`
 * locale that renders English until the RTL layout lands separately, so
 * every locale that can actually be selected reads left to right.
 */
export function dirFor(_locale: Locale): "ltr" | "rtl" {
  return "ltr";
}

/*
 * Stable API error codes -> translation keys.
 *
 * Auth routes answer with a stable `code` in the JSON body and the interface
 * maps it to translated text. A page must never print the server's English
 * `error` string. Unknown codes fall back to a generic translated message.
 */
const ERROR_CODE_KEYS: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: "error.invalid_credentials",
  AUTH_RATE_LIMITED: "error.rate_limited",
  AUTH_REGISTRATION_DISABLED: "error.registration_disabled",
  AUTH_CAPTCHA_FAILED: "error.captcha_failed",
  AUTH_INVALID_TOKEN: "error.invalid_token",
  AUTH_EMAIL_TAKEN: "error.email_taken",
};

export function errorKey(code: string | undefined | null): string {
  if (code && ERROR_CODE_KEYS[code]) return ERROR_CODE_KEYS[code];
  return "error.generic";
}

/** Map an API error `code` to translated text; never echoes the server's English. */
export function errorText(t: Translate, code: string | undefined | null): string {
  return t(errorKey(code));
}

// ---- Intl -----------------------------------------------------------------

/**
 * BCP-47 tag used for every `Intl` call in the product.
 *
 * Arabic is the one exception to a straight locale mapping: `ar` by default
 * formats with Arabic-Indic digits (٠١٢٣), which then cannot be fed back into
 * arithmetic, compared as strings, or printed by a PDF font. Money, odometer
 * and distance readings are therefore pinned to Latin digits with the
 * `nu-latn` extension while still using Arabic month and weekday names.
 *
 * The tag also matches the currency actually chosen in the user's settings —
 * locale controls *format*, never *currency*.
 */
export function intlLocale(locale: Locale): string {
  const base: Record<Locale, string> = {
    en: "en-US",
    fr: "fr-FR",
    es: "es-ES",
    "pt-BR": "pt-BR",
    de: "de-DE",
    ar: "ar-EG",
  };
  const tag = base[locale] ?? base[DEFAULT_LOCALE];
  return locale === "ar" ? `${tag}-u-nu-latn` : tag;
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), options).format(value);
  } catch {
    return String(value);
  }
}

/** Dates in the user's locale, ISO-like when no options are given. */
export function formatDate(
  locale: Locale,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" }
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
