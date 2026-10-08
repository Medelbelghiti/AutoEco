import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  LOCALES,
  READY_LOCALES,
  LOCALE_STATUS,
  coerceLocale,
  effectiveLocale,
  translate,
  translator,
  translateEnum,
  plural,
  pluralCategory,
  dirFor,
  getDictionary,
  errorKey,
  errorText,
  formatNumber,
  formatDate,
} from "@/lib/i18n";
import { EMAIL_READY_LOCALES, renderEmailCopy, renderEmailCopyForLocale } from "@/lib/email-i18n";
import { trueCostRowKey, formatMoney } from "@/lib/finance";

type Dict = Record<string, string>;

function loadJson(path: string): Dict {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function collectKeys(obj: Dict, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      keys.push(...collectKeys(v as any, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}

function extractPlaceholders(s: string): string[] {
  const m = s.match(/\{[^}]+\}/g);
  return m ? m.sort() : [];
}

/**
 * Brand/product names, units and numeric/code tokens that are legitimately
 * identical to English in every locale. This list must contain ONLY brand
 * names, numbers, symbols and units.
 *
 * Brand and product names (never translated): AutoEco, Financial Twin,
 * Ask Your Car. Units and codes used as labels: km, mi and the badge tokens
 * ACTUAL / ESTIMATE / FORECAST / DELETE (pure numbers and symbol-only strings
 * are handled by the regex below, not this list).
 */
const IDENTICAL_ALLOWLIST = new Set([
  "AutoEco",
  "Financial Twin",
  "Ask Your Car",
  "km",
  "mi",
  "ACTUAL",
  "ESTIMATE",
  "FORECAST",
  "DELETE",
]);

/**
 * Words whose correct translation is literally the same word (or the same
 * universal acronym) in that language, so the value must be identical to
 * English. These are genuine same-word translations, not English copies left
 * behind, and are documented per locale:
 *   fr:  Garage (garage.title, nav.garage), Date (common.date),
 *        Distance (common.distance, dashboard.badge_distance),
 *        Sections (shell.sections), Assistant (nav.assistant),
 *        FAQ (nav.faq — universal Latin acronym)
 *   es:  Plan (settings.plan — Spanish for plan)
 *   pt-BR: (none — all Portuguese values are distinct)
 *   de:  Garage (garage.title, nav.garage), Name (common.name),
 *        Plan (settings.plan), FAQ (nav.faq — universal Latin acronym)
 */
const IDENTICAL_NATIVE_WORDS = new Set([
  "Garage",
  "Date",
  "Distance",
  "Sections",
  "Assistant",
  "Plan",
  "Name",
  "FAQ",
]);

function isAllowedIdentical(v: string): boolean {
  if (IDENTICAL_ALLOWLIST.has(v) || IDENTICAL_NATIVE_WORDS.has(v)) return true;
  // Pure numbers, symbols and units-with-numbers are safe to leave identical.
  if (/^[\d.,\s%+\-/()]*[\d][\d.,\s%+\-/()]*$/.test(v)) return true;
  return false;
}

describe("i18n key parity", () => {
  const root = join(__dirname, "..", "src", "locales");
  const en = loadJson(join(root, "en.json"));
  const enKeys = collectKeys(en);

  for (const loc of LOCALES) {
    it(`${loc} has complete, clean key set vs en`, () => {
      const dict = loadJson(join(root, `${loc}.json`));
      const keys = collectKeys(dict);

      const missing = enKeys.filter((k) => !(k in dict));
      const extra = keys.filter((k) => !(k in en));

      expect(missing, `${loc}: missing keys`).toEqual([]);
      expect(extra, `${loc}: extra keys`).toEqual([]);

      for (const k of enKeys) {
        const v = dict[k];
        expect(typeof v).toBe("string");
        expect(v.length).toBeGreaterThan(0);
        const enPh = extractPlaceholders(en[k]);
        const ph = extractPlaceholders(v);
        expect(ph).toEqual(enPh);
      }
    });
  }
});

describe("no unfinished translations in ready locales", () => {
  const root = join(__dirname, "..", "src", "locales");
  const en = loadJson(join(root, "en.json"));

  for (const loc of LOCALES) {
    const expectedStatus = loc === "ar" ? "pending" : "ready";
    it(`${loc} is marked ${expectedStatus} in LOCALE_STATUS`, () => {
      expect(LOCALE_STATUS[loc]).toBe(expectedStatus);
    });

    if (loc === "en" || LOCALE_STATUS[loc] !== "ready") continue;

    it(`${loc} has no value identical to English outside the allowlist`, () => {
      const dict = loadJson(join(root, `${loc}.json`));
      const bad: Array<[string, string]> = [];
      for (const k of Object.keys(en)) {
        const v = dict[k];
        if (v === en[k] && !isAllowedIdentical(v)) {
          bad.push([k, v]);
        }
      }
      expect(bad, `${loc}: identical-to-English values not in allowlist`).toEqual([]);
    });
  }
});

describe("English is the safe fallback", () => {
  const root = join(__dirname, "..", "src", "locales");
  const en = loadJson(join(root, "en.json"));

  it("a missing key in ANY locale falls back to English, never the raw key", () => {
    for (const loc of LOCALES) {
      const out = translate(loc, "definitely.not.a.key");
      expect(out).not.toBe("definitely.not.a.key");
      expect(out).toBe("");
    }
  });

  it("a key with no English counterpart renders empty, not a broken key", () => {
    expect(translate("fr", "some.key.that.en.lacks")).toBe("");
  });

  it("the pending locale (ar) renders English copy", () => {
    expect(effectiveLocale("ar")).toBe("en");
    expect(translate("ar", "hero.title")).toBe(en["hero.title"]);
  });

  it("getDictionary returns English for a pending locale", () => {
    expect(getDictionary("ar")).toBe(getDictionary("en"));
  });

  it("coerceLocale maps legacy and regional tags to a shipped locale", () => {
    expect(coerceLocale("en")).toBe("en");
    expect(coerceLocale("pt")).toBe("pt-BR");
    expect(coerceLocale("pt-PT")).toBe("pt-BR");
    expect(coerceLocale("de-DE")).toBe("de");
    expect(coerceLocale("fr")).toBe("fr");
    expect(coerceLocale("FR")).toBe("fr");
  });

  it("coerceLocale degrades unknown or malformed values to en", () => {
    expect(coerceLocale("zh-CN")).toBe("en");
    expect(coerceLocale("zz")).toBe("en");
    expect(coerceLocale(undefined)).toBe("en");
    expect(coerceLocale(null)).toBe("en");
    expect(coerceLocale("")).toBe("en");
  });

  it("all installed dicts typecheck at runtime to non-empty strings", () => {
    for (const loc of LOCALES) {
      const dict = getDictionary(loc);
      for (const k of Object.keys(dict)) {
        expect(typeof dict[k]).toBe("string");
        expect(dict[k].length).toBeGreaterThan(0);
      }
    }
  });
});

describe("plural forms", () => {
  const cases: Array<[string, number, string]> = [
    // [locale, count, expected category]
    ["en", 1, "one"],
    ["en", 2, "other"],
    ["en", 0, "other"],
    ["fr", 0, "one"],
    ["fr", 1, "one"],
    ["fr", 2, "other"],
    ["es", 1, "one"],
    ["es", 2, "other"],
    ["es", 0, "other"],
    ["pt-BR", 1, "one"],
    ["pt-BR", 2, "other"],
    ["de", 1, "one"],
    ["de", 2, "other"],
  ];

  it.each(cases)("%s %i picks the %s form", (locale, count, cat) => {
    const out = plural(locale as any, count, {
      one: "ONE",
      many: "MANY",
      other: "OTHER",
    });
    expect(out).toBe(cat.toUpperCase());
  });

  it("Arabic exposes all six plural categories via the raw rules", () => {
    expect(pluralCategory("ar", 0)).toBe("zero");
    expect(pluralCategory("ar", 1)).toBe("one");
    expect(pluralCategory("ar", 2)).toBe("two");
    expect(pluralCategory("ar", 3)).toBe("few");
    expect(pluralCategory("ar", 10)).toBe("few");
    expect(pluralCategory("ar", 11)).toBe("many");
    expect(pluralCategory("ar", 99)).toBe("many");
    expect(pluralCategory("ar", 100)).toBe("other");
    expect(pluralCategory("ar", 103)).toBe("few");
    expect(pluralCategory("ar", 1000)).toBe("other");
  });

  it("Arabic pending still renders English plural rules through plural()", () => {
    expect(plural("ar", 1, { one: "ONE", other: "OTHER" })).toBe("ONE");
    expect(plural("ar", 2, { one: "ONE", other: "OTHER" })).toBe("OTHER");
  });

  it("a missing Arabic category form falls back to other", () => {
    // three in Arabic is "few", which is not supplied -> other is used
    expect(plural("en", 3, { other: "FALLBACK" })).toBe("FALLBACK");
    expect(pluralCategory("ar", 3)).toBe("few");
  });
});

describe("true-cost breakdown labels render via keys in every ready locale", () => {
  const ids = ["operating", "forwardFixed", "depreciation"] as const;

  for (const loc of READY_LOCALES) {
    it(`${loc} renders the three breakdown labels from keys`, () => {
      const t = translator(loc);
      const rendered = ids.map((id) => ({ id, text: t(trueCostRowKey(id)) }));
      for (const { id, text } of rendered) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toBe(trueCostRowKey(id));
      }
    });
  }

  it("every key exists in English (reference) so a missing key can never print raw", () => {
    const en = getDictionary("en");
    for (const id of ids) {
      expect(en[trueCostRowKey(id)]).toBeTruthy();
    }
  });
});

describe("trips count plural forms across locales", () => {
  const counts = [0, 1, 2, 5];
  const expected: Record<string, Record<number, string>> = {
    fr: { 0: "0 trajet", 1: "1 trajet", 2: "2 trajets", 5: "5 trajets" },
    es: { 0: "0 viajes", 1: "1 viaje", 2: "2 viajes", 5: "5 viajes" },
    "pt-BR": { 0: "0 viagem", 1: "1 viagem", 2: "2 viagens", 5: "5 viagens" },
    de: { 0: "0 Fahrten", 1: "1 Fahrt", 2: "2 Fahrten", 5: "5 Fahrten" },
  };

  for (const loc of ["fr", "es", "pt-BR", "de"] as const) {
    it(`${loc} renders 0/1/2/5 with the correct singular/plural form`, () => {
      const t = translator(loc);
      for (const count of counts) {
        const forms = {
          zero: t("trips.trip_count_zero", { count }),
          one: t("trips.trip_count_one", { count }),
          two: t("trips.trip_count_two", { count }),
          few: t("trips.trip_count_few", { count }),
          many: t("trips.trip_count_many", { count }),
          other: t("trips.trip_count_other", { count }),
        };
        expect(plural(loc, count, forms)).toBe(expected[loc][count]);
      }
    });
  }

  it("uses the 'other' form for 2 and 5 in every ready locale", () => {
    for (const loc of ["fr", "es", "pt-BR", "de"] as const) {
      for (const count of [2, 5]) {
        const forms = { one: "ONE", other: "OTHER" };
        expect(plural(loc, count, forms)).toBe("OTHER");
      }
    }
  });

  it("Arabic renders every trip-count form from its own keys", () => {
    // translator("ar") falls back to English while pending, so read the
    // Arabic JSON directly and drive the forms through pluralCategory("ar").
    const arDict = loadJson(join(__dirname, "..", "src", "locales", "ar.json"));
    const valueAt = (dotted: string) => arDict[dotted];
    const formsFor = (count: number) => {
      const val = (dotted: string) => valueAt(dotted).replace("{count}", String(count));
      return {
        zero: val("trips.trip_count_zero"),
        one: val("trips.trip_count_one"),
        two: val("trips.trip_count_two"),
        few: val("trips.trip_count_few"),
        many: val("trips.trip_count_many"),
        other: val("trips.trip_count_other"),
      };
    };
    const render = (count: number) => formsFor(count)[pluralCategory("ar", count)];
    expect(render(0)).toBe("0 رحلات"); // zero
    expect(render(1)).toBe("1 رحلة"); // one
    expect(render(2)).toBe("2 رحلتان"); // two
    expect(render(3)).toBe("3 رحلات"); // few
    expect(render(11)).toBe("11 رحلة"); // many
    expect(render(70)).toBe("70 رحلة"); // many
    expect(render(100)).toBe("100 رحلة"); // other
    expect(render(103)).toBe("103 رحلات"); // few
  });
});

describe("API error codes map to translated text", () => {
  it("known codes resolve to error.* keys and translated text", () => {
    expect(errorKey("AUTH_INVALID_CREDENTIALS")).toBe("error.invalid_credentials");
    expect(errorKey("AUTH_RATE_LIMITED")).toBe("error.rate_limited");
    expect(errorKey("AUTH_REGISTRATION_DISABLED")).toBe("error.registration_disabled");
    expect(errorKey("AUTH_CAPTCHA_FAILED")).toBe("error.captcha_failed");
    expect(errorKey("AUTH_INVALID_TOKEN")).toBe("error.invalid_token");
    expect(errorKey("AUTH_EMAIL_TAKEN")).toBe("error.email_taken");
  });

  it("unknown codes fall back to the generic translated message", () => {
    expect(errorKey(undefined)).toBe("error.generic");
    expect(errorKey(null)).toBe("error.generic");
    expect(errorKey("SOME_NEW_CODE")).toBe("error.generic");
  });

  it("a translated screen never prints the server's English error string", () => {
    const t = translator("fr");
    const text = errorText(t, "AUTH_INVALID_CREDENTIALS");
    expect(text).not.toBe("Invalid email or password.");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toBe(t("error.invalid_credentials"));
  });
});

describe("enum translation leaves unknown values alone", () => {
  const t = translator("es");

  it("translates a known enum", () => {
    expect(translateEnum(t, "status.", "ACTIVE")).toBe(t("status.active"));
  });

  it("returns the raw value when no key exists (never status.xxx)", () => {
    expect(translateEnum(t, "status.", "WEIRD_VALUE")).toBe("WEIRD_VALUE");
  });
});

describe("dirFor and ready list stay consistent", () => {
  it("every ready locale renders left-to-right", () => {
    for (const loc of READY_LOCALES) {
      expect(dirFor(loc)).toBe("ltr");
    }
  });

  it("Arabic is the only right-to-left locale, regardless of status", () => {
    expect(dirFor("ar")).toBe("rtl");
    for (const loc of ["en", "fr", "es", "pt-BR", "de"] as const) {
      expect(dirFor(loc)).toBe("ltr");
    }
  });

  it("READY_LOCALES excludes the pending locale and includes the rest", () => {
    expect(READY_LOCALES).not.toContain("ar");
    expect(READY_LOCALES).toContain("en");
    expect(READY_LOCALES).toContain("fr");
  });
});

describe("Arabic numbers, money and dates use Latin digits", () => {
  it("formatNumber prints Latin digits for ar (nu-latn), never Arabic-Indic", () => {
    const out = formatNumber("ar", 12345.5);
    expect(out).toMatch(/[0-9]/);
    expect(out).not.toMatch(/[٠-٩]/);
    expect(out).toContain("12");
  });

  it("formatDate for ar uses Latin digits and Gregorian default", () => {
    const date = new Date(2026, 0, 8); // 2026-01-08
    const out = formatDate("ar", date);
    expect(out).not.toMatch(/[٠-٩]/);
    expect(out).toMatch(/[0-9]/);
  });

  it("money for ar renders with Latin digits via intlLocale (ar-EG-u-nu-latn)", () => {
    const out = formatMoney(123456, "USD", "ar-EG-u-nu-latn");
    expect(out).toMatch(/[0-9]/);
    expect(out).not.toMatch(/[٠-٩]/);
  });
});

describe("email copy is localized with English fallback", () => {
  const params = {
    name: "Lucía",
    appUrl: "https://autoeco.app",
    link: "https://autoeco.app/verify/tok",
    planName: "Pro",
    days: 14,
    endDate: "2026-01-31",
    label: "vehicles",
  };
  const emailKeys = [
    "welcome",
    "emailVerify",
    "passwordReset",
    "signupAttemptNotice",
    "trialStarted",
    "trialEnding",
    "paymentSuccess",
    "paymentFailed",
    "subscriptionCanceled",
    "usageLimitReached",
  ] as const;

  it("ships real copy for exactly the ready locales, derived from READY_LOCALES", () => {
    expect(EMAIL_READY_LOCALES).toEqual(READY_LOCALES);
    expect(EMAIL_READY_LOCALES).toEqual(["en", "fr", "es", "pt-BR", "de"]);
    // Arabic is modularized and translated, but the readiness gate guards it.
    expect(LOCALE_STATUS.ar).toBe("pending");
    expect(EMAIL_READY_LOCALES).not.toContain("ar");
  });

  it("renders French copy for a French locale", () => {
    const out = renderEmailCopy("fr", "welcome", params);
    expect(out.subject).toBe("Bienvenue sur AutoEco");
    expect(out.html).toContain("Bonjour Lucía");
    expect(out.text).toContain("{appUrl}/dashboard".replace("{appUrl}", params.appUrl as string));
  });

  it("fills placeholders in every shipped locale", () => {
    for (const loc of EMAIL_READY_LOCALES) {
      for (const key of emailKeys) {
        const out = renderEmailCopy(loc, key, params);
        expect(out.subject).not.toMatch(/\{(\w+)\}/);
        expect(out.text).not.toMatch(/\{(\w+)\}/);
        expect(out.html).not.toMatch(/\{(\w+)\}/);
      }
    }
  });

  it("a pending locale gets English copy", () => {
    // effectiveLocale maps ar to en while pending, so the send path never
    // emits Arabic before the review gate flips.
    expect(effectiveLocale("ar")).toBe("en");
    const out = renderEmailCopy("ar", "welcome", params);
    expect(out.subject).toBe("Welcome to AutoEco");
    expect(out.html).not.toContain("dir=\"rtl\"");
  });

  it("Arabic ships all ten templates, non-English and fully filled", () => {
    const arabic = /[\u0600-\u06FF]/;
    for (const key of emailKeys) {
      const out = renderEmailCopyForLocale("ar", key, params);
      expect(out.subject).toMatch(arabic);
      expect(out.subject).not.toMatch(/\{(\w+)\}/);
      expect(out.text).toMatch(arabic);
      expect(out.text).not.toMatch(/\{(\w+)\}/);
      expect(out.html).toMatch(arabic);
      expect(out.html).not.toMatch(/\{(\w+)\}/);
    }
  });

  it("Arabic emails render as a full RTL UTF-8 document and keep links", () => {
    const out = renderEmailCopyForLocale("ar", "welcome", params);
    expect(out.html).toContain("<html lang=\"ar\" dir=\"rtl\">");
    expect(out.html).toContain("<meta charset=\"utf-8\" />");
    expect(out.html).toContain("dir=\"rtl\"");
    // URLs and the app domain are embedded LTR inside the RTL body.
    expect(out.html).toContain("<bdi dir=\"ltr\">");
    expect(out.html).toContain('href="https://autoeco.app/dashboard"');
    expect(out.html).toContain("https://autoeco.app/dashboard");
    // The prepare link stays intact on every template.
    const reset = renderEmailCopyForLocale("ar", "passwordReset", params);
    expect(reset.html).toContain('href="https://autoeco.app/verify/tok"');
    expect(reset.html).toContain("https://autoeco.app/verify/tok");
  });
});