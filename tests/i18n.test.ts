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
  dirFor,
  getDictionary,
  errorKey,
  errorText,
} from "@/lib/i18n";
import { EMAIL_READY_LOCALES, renderEmailCopy } from "@/lib/email-i18n";

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
 * Values that are legitimately identical to English.
 *
 * Brand and product names (never translated), units and codes used as labels,
 * and a handful of words that are the same word in the target language
 * (Garage, Date, Distance, Plan, Name, Sections, FAQ, Docs, Admin, Assistant,
 * Note, Personal, (optional)). Anything else identical to English in a *ready*
 * locale is an unfinished translation and must fail the build.
 */
const IDENTICAL_ALLOWLIST = new Set([
  "AutoEco",
  "Financial Twin",
  "Ask Your Car",
  "Garage",
  "Date",
  "Distance",
  "Name",
  "Plan",
  "Sections",
  "FAQ",
  "Docs",
  "Admin",
  "Assistant",
  "Note",
  "Personal",
  "(optional)",
  "km",
  "mi",
  "ACTUAL",
  "ESTIMATE",
  "FORECAST",
  "DELETE",
]);

function isAllowedIdentical(v: string): boolean {
  if (IDENTICAL_ALLOWLIST.has(v)) return true;
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
    const out = plural(locale as any, count, "ONE", "OTHER", "MANY");
    expect(out).toBe(cat.toUpperCase());
  });

  it("Arabic degrades to English plural rules while pending", () => {
    expect(plural("ar", 1, "ONE", "OTHER")).toBe("ONE");
    expect(plural("ar", 2, "ONE", "OTHER")).toBe("OTHER");
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
  it("every locale we can render is LTR (RTL lands with Arabic)", () => {
    for (const loc of READY_LOCALES) {
      expect(dirFor(loc)).toBe("ltr");
    }
  });

  it("READY_LOCALES excludes the pending locale and includes the rest", () => {
    expect(READY_LOCALES).not.toContain("ar");
    expect(READY_LOCALES).toContain("en");
    expect(READY_LOCALES).toContain("fr");
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

  it("ships real copy for exactly the ready locales", () => {
    expect(EMAIL_READY_LOCALES).toEqual(["en", "fr", "es", "pt-BR", "de"]);
  });

  it("renders French copy for a French locale", () => {
    const out = renderEmailCopy("fr", "welcome", params);
    expect(out.subject).toBe("Bienvenue sur AutoEco");
    expect(out.html).toContain("Bonjour Lucía");
    expect(out.text).toContain("{appUrl}/dashboard".replace("{appUrl}", params.appUrl as string));
  });

  it("fills placeholders in every shipped locale", () => {
    for (const loc of EMAIL_READY_LOCALES) {
      for (const key of ["welcome", "trialStarted", "paymentSuccess", "usageLimitReached"] as const) {
        const out = renderEmailCopy(loc, key, params);
        expect(out.subject).not.toMatch(/\{(\w+)\}/);
        expect(out.text).not.toMatch(/\{(\w+)\}/);
        // html keeps {link} only where the template intentionally has none;
        // all parameters we pass must be gone from both subject and text.
      }
    }
  });

  it("a pending locale gets English copy", () => {
    const out = renderEmailCopy("ar", "welcome", params);
    expect(out.subject).toBe("Welcome to AutoEco");
  });
});