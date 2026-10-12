"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, translator, type Locale, type Translate } from "@/lib/i18n";

type LocaleValue = { locale: Locale; t: Translate };

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  t: translator(DEFAULT_LOCALE),
});

/**
 * Makes the request locale available to client components.
 *
 * Client pages (the whole sign-in and sign-up flow is one) cannot call
 * `cookies()`, and reading `document.cookie` during render would disagree with
 * what the server painted. The root layout resolves the locale once, server
 * side, and hands it down here, so both renders start from the same value.
 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<LocaleValue>(() => ({ locale, t: translator(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useT(): Translate {
  return useContext(LocaleContext).t;
}
