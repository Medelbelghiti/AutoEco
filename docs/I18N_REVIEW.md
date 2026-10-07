# AutoEco Internationalization Review

This document lists all machine-translated strings that **need native review** per locale (rule 8). It records the scope, the real-vs-copy counts per locale, risk areas and per-locale confidence. It is updated when a locale key set changes (e.g. new `error.*` keys).

## 1. Scope and status

- **Locale key set (UI copy):** `en.json` is the superset with **370 keys** (see section breakdown below). Every other locale is verified to match it exactly (no missing, no extra, no empty values, identical `{placeholder}` sets) by `tests/i18n.test.ts`.
- **Transactional email copy:** 10 templates (`welcome`, `emailVerify`, `passwordReset`, `signupAttemptNotice`, `trialStarted`, `trialEnding`, `paymentSuccess`, `paymentFailed`, `subscriptionCanceled`, `usageLimitReached`) shipped for the 5 ready locales in `src/lib/email-i18n.ts`. Arabic falls back to English (pending).
- **Scope of this change:** shell/nav, auth, common chrome, dashboard, garage list, expenses, fuel, insights, financial-twin, scenarios, settings, reports + 7 `error.*` keys + 8 `status.*` keys + 14 `category.*` keys + product emails. Translation keys exist for receipts/trips/assistant but the **page conversions for `trips/*`, `receipts`, `assistant`, and `garage/[id]` are still English-only** and are listed as pending below.
- **Pending (not translated now):** marketing sub-pages (features/docs/FAQ — partially covered by keys above but page bodies remain English) and the 12 calculators. These remain English where out of the key set.
- **Locale readiness for selectors:** selectors show ONLY `ready` locales (`LOCALE_STATUS` in `src/lib/i18n.ts`). `ar` is `pending` until COMMIT B.

### en.json key breakdown by section (370 total)

| Section | Keys |
|---|---|
| settings | 37 |
| auth | 43 |
| common | 32 |
| nav | 27 |
| dashboard | 25 |
| reports | 23 |
| scenarios | 15 |
| features | 14 |
| category | 14 |
| ask | 13 |
| preview | 13 |
| trust | 11 |
| how | 10 |
| insights | 10 |
| garage | 9 |
| fuel | 6 |
| twin | 6 |
| shell | 5 |
| legal | 5 |
| status | 8 |
| error | 7 |
| diff | 16 |
| cta | 4 |
| expenses | 2 |
| promise | 2 |
| brand | 2 |
| hero | 7 |
| footer | 4 |

## 2. Real translation vs copy of English (per locale)

Parity test reports any value identical to English. The allowlist (section 5 of the glossary) treats brand/product proper nouns, `DELETE`, `km`/`mi`, `ACTUAL`/`ESTIMATE`/`FORECAST`, units, numbers and symbols as "not a copy". Counts below are on the **370-key set**.

| Locale | Total keys | Identical to English | Identical but allowlisted | Copies of English (must be 0) | Status |
|---|---|---|---|---|---|
| en | 370 | 370 (reference) | — | — | ready |
| fr | 370 | **14** | 14 | **0** | ready |
| es | 370 | **10** | 10 | **0** | ready |
| pt-BR | 370 | **9** | 9 | **0** | ready |
| de | 370 | **14** | 14 | **0** | ready |
| ar | 370 | 370 | 370 (mirror) | n/a (pending) | pending |

The identical-but-allowlisted values are exactly: `brand.name`, `diff.autoeco.title` (`AutoEco`); the product names `Financial Twin` (`hero.badge`, `features.twin.title`, `preview.title`, `nav.financial_twin`), `Ask Your Car` (`dashboard.qa_assistant`, `ask.name`); and true cognates/loanwords that are legitimate in the target language: `Garage` (fr/de), `Date` (fr), `Distance` (fr), `Name` (de), `Plan` (es/de), `Sections` (fr), `FAQ`, `Docs` (fr), `Admin`, `Assistant` (fr/de).

## 3. Machine translation posture

All strings below were produced by machine translation (agent). No translation is claimed final. Each locale block lists what needs native review.

Risky strings (billing, trial, refund, tax, limits, security/2FA, deletion, mixed-currency, PDF disclaimers, email copy) are flagged with `RISK:`.

## 4. Per-locale review lists

### fr (French) — status: needs native review
Confidence: **medium–high**. Formal register `vous` verified throughout including `report-pdf-text.ts` and emails.  
**Identical to English: 14, all allowlisted (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.trial_ends`, `settings.manage_billing`, `status.past_due/unpaid/canceled`, `error.rate_limited/registration_disabled`
- RISK: `reports.*` PDF labels (`reports.standing_note`, `reports.actual_note`, `reports.pdf_english_warning`, `reports.pdf_locked_title/body`)
- RISK: email copy in `src/lib/email-i18n.ts` (fr): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- Mixed-currency warnings: `common.mixed_currency_title/body`, `insights.mixed_body`, `reports.mixed_body`, `scenarios.mixed_body`
- `scenarios.*`, `dashboard.*` short labels, `category.*` list

### es (Spanish) — status: needs native review
Confidence: **medium**. Formal register `usted` verified; Iberian-flavored; confirm date/number contexts and some Latin American alternatives.  
**Identical to English: 10, all allowlisted (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.plan`, `status.*`, `error.*`
- RISK: email copy (es): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- RISK: PDF disclaimers and table headers (`reports.*`)
- Mixed-currency warnings (`common.mixed_currency_*`, `insights.mixed_body`, `scenarios.mixed_body`, `reports.mixed_body`)
- `scenarios.*`, `insights.*`, `dashboard.*`

### pt-BR (Brazilian Portuguese) — status: needs native review
Confidence: **medium**. Formal register `você` verified.  
**Identical to English: 9, all allowlisted (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.manage_billing`, `status.*`, `error.*`
- RISK: email copy (pt-BR): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- RISK: PDF labels (`reports.*`)
- Vehicle/garage terminology: `garage.*`, `fuel.*`, "quilometragem"` in `common.distance`, `settings.distance`
- Mixed-currency warnings

### de (German) — status: needs native review
Confidence: **medium**. Formal register `Sie` verified.  
**Identical to English: 14, all allowlisted (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.trial_ends`, `status.*`, `error.*`
- RISK: email copy (de): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- RISK: PDF disclaimers (`reports.*`)
- Compound nouns: `Wertminderung/Abwertung`, `Kraftstoffverbrauch` (`fuel.*`), `Kilometerstand` in `reports.distance_driven`
- Mixed-currency warnings

### ar (Arabic) — status: **pending (not ready)**
Arabic strings are mirrors of English (`ar.json` duplicates `en.json`, 370/370 identical) so the parity test passes while selectors stay disabled. Arabic content + RTL layout land in **COMMIT B**. Do not expose in UI until ready.

## 5. Pending (explicitly out of scope for COMMIT A translation)
- Marketing sub-pages bodies not covered by the key set (features/docs/FAQ detail pages).
- Calculators (~12 calculators) — remain English.
- **Page conversions still English-only:** `src/app/(app)/trips/page.tsx`, `trips/new`, `trips/[id]/edit`, `receipts/page.tsx`, `assistant/page.tsx`, `garage/[id]/page.tsx`. The locale files contain keys for these surfaces but the React screens have not been wired to `useT(...)` yet.
- Any UI error strings not yet routed through `errorText` (see next section).

## 6. API error codes -> translated text

Auth routes return a stable `code` in the JSON body; the interface maps it via `errorKey()`/`errorText()` and never prints the server's English `error` string.

| Code | Key |
|---|---|
| AUTH_INVALID_CREDENTIALS | error.invalid_credentials |
| AUTH_RATE_LIMITED | error.rate_limited |
| AUTH_REGISTRATION_DISABLED | error.registration_disabled |
| AUTH_CAPTCHA_FAILED | error.captcha_failed |
| AUTH_INVALID_TOKEN | error.invalid_token |
| AUTH_EMAIL_TAKEN | error.email_taken (fallback for unknown codes: error.generic) |

Screens wired: login, signup, forgot-password, reset-password, verify-email, settings profile forms (deduction rate uses `errorText`).

## 7. Fallback behavior (tested)
- Missing key in a locale -> English value; a key missing from English -> `""` (never the raw dotted key). `translate()` enforces this.
- `coerceLocale()` maps legacy/regional values (`pt`, `pt-PT`, `de-DE`) to a shipped locale; unknown values (`zh-CN`, `zz`, `null`, `""`) -> `en`.
- Pending locale (`ar`) -> renders English (`effectiveLocale`).
- Email copy: pending locale (`ar`) -> English; every shipped locale renders fully (no un-filled `{placeholder}` in subject/text).
- Profile API (`PATCH /api/profile`) rejects any non-ready locale via `StoredLocaleSchema`, so a pending locale can never become a durable preference.

## 8. Verification notes
- `tests/i18n.test.ts` (48 tests): parity (missing/extra/empty/placeholders), identical-value detection with allowlist for ready locales, fallback-to-English, legacy-locale coercion, plural selection (`Intl.PluralRules`) for en/fr/es/pt-BR/de, error-code mapping, enum translation, RTL held out, email-copy localization + fallback.
- `tests/profile-locale.test.ts` (5 tests, real DB): PATCH/GET persist locale, pending `ar` rejected, junk locale rejected, LOCALE_STATUS/READY_LOCALES coherence.
- Locale selector exposes only `ready` locales. `ar` = pending.
- Unknown/legacy locale values fall back to `en`. Direct URL/cookie with pending locale falls back to `en`.
- PDF: fr/es/pt-BR/de translated labels; `ar` uses English PDF with warning only when the PDF cannot render.

## 9. Native review checklist (to complete post-commit)
- [ ] Verify formal register (`vous`/`usted`/`você`/`Sie`) in all 4 ready locales — automated checks cover the four ready locales in tests, spot-check naturalness.
- [ ] Review all `RISK:` strings (billing/trial/refund/tax/security/deletion/PDF) per locale block above.
- [ ] Sanity-check email subjects/bodies (`src/lib/email-i18n.ts`) for clarity and no PII leakage.
- [ ] Confirm placeholders preserved and counts/plurals sound natural.
- [ ] Approve glossary terms for each locale.