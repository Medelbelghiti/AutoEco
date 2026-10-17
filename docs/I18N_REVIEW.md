# AutoEco Internationalization Review

This document lists all machine-translated strings that **need native review** per locale (rule 8). It records the scope, the real-vs-copy counts per locale, risk areas and per-locale confidence. It is updated when a locale key set changes (e.g. new `error.*` keys).

## 1. Scope and status

- **Locale key set (UI copy):** `en.json` is the superset with **478 keys** (see section breakdown below). Every other locale is verified to match it exactly (no missing, no extra, no empty values, identical `{placeholder}` sets) by `tests/i18n.test.ts`.
- **Transactional email copy:** 10 templates (`welcome`, `emailVerify`, `passwordReset`, `signupAttemptNotice`, `trialStarted`, `trialEnding`, `paymentSuccess`, `paymentFailed`, `subscriptionCanceled`, `usageLimitReached`) shipped for the ready locales in `src/lib/email-i18n.ts`. **COMMIT B** adds a full Arabic set (with `dir="rtl"` full-document rendering) that is gated by the same status rule: `EMAIL_READY_LOCALES` is derived from `READY_LOCALES`, and a pending `ar` still receives English copy on the send path.
- **Scope of this change:** shell/nav, auth, common chrome, dashboard, garage (list + detail), trips (list/new/edit + forms), receipts, assistant, expenses, fuel, insights, financial-twin, scenarios, settings, reports + 7 `error.*` keys + 8 `status.*` keys + 14 `category.*` keys + product emails.
- **Pending (not translated now):** marketing sub-pages (features/docs/FAQ — partially covered by keys above but page bodies remain English) and the 12 calculators. These remain English where out of the key set.
- **Locale readiness for selectors:** selectors show ONLY `ready` locales (`LOCALE_STATUS` in `src/lib/i18n.ts`). Only `en` and `fr` are `ready`; `es`, `pt-BR`, `de` and `ar` are translated but held at `pending` (not selectable, still render English in the UI and emails) until a native-speaker review confirms them. `ar` additionally ships full RTL layout (COMMIT B).

### en.json key breakdown by section (478 total)

| Section | Keys |
|---|---|
| trips | 46 |
| auth | 43 |
| settings | 39 |
| common | 37 |
| nav | 27 |
| dashboard | 25 |
| reports | 23 |
| receipts | 22 |
| twin | 17 |
| diff | 16 |
| scenarios | 15 |
| features | 14 |
| category | 14 |
| ask | 13 |
| preview | 13 |
| assistant | 12 |
| trust | 11 |
| garage | 11 |
| how | 10 |
| insights | 10 |
| fuel | 8 |
| status | 8 |
| hero | 7 |
| expenses | 7 |
| error | 7 |
| legal | 5 |
| shell | 5 |
| footer | 4 |
| cta | 4 |
| brand | 2 |
| promise | 2 |
| pricing | 1 |

## 2. Real translation vs copy of English (per locale)

Parity test reports any value identical to English. The exclusion set is split in `tests/i18n.test.ts`:
- `IDENTICAL_ALLOWLIST` — strict: only brand/product names (`AutoEco`, `Financial Twin`, `Ask Your Car`), units (`km`, `mi`) and code tokens (`DELETE`, `ACTUAL`, `ESTIMATE`, `FORECAST`); numbers/symbols pass via regex.
- `IDENTICAL_NATIVE_WORDS` — words whose correct translation is literally the same word/acronym in that language (documented per locale, see below).

Copies of English (identical and *not* in either set) must be 0 in every ready locale.

| Locale | Total keys | Identical to English | Identical but excluded (brands/units/codes + native words) | Copies of English (must be 0) | Status |
|---|---|---|---|---|---|
| en | 478 | 478 (reference) | — | — | ready |
| fr | 478 | **12** | 12 | **0** | ready |
| es | 478 | **9** | 9 | **0** | pending |
| pt-BR | 478 | **8** | 8 | **0** | pending |
| de | 478 | **13** | 13 | **0** | pending |
| ar | 478 | **9** | 9 | **0** | pending |

The identical values are exactly:
- Brands/products (all ready locales): `AutoEco` (`brand.name`, `diff.autoeco.title`), `Financial Twin` (`hero.badge`, `features.twin.title`, `preview.title`, `nav.financial_twin`), `Ask Your Car` (`dashboard.qa_assistant`, `ask.name`).
- Native same-word translations (unavoidable — the word is identical in that language): fr — `Garage` (`garage.title`, `nav.garage`), `Date` (`common.date`), `Distance` (`common.distance`, `dashboard.badge_distance`), `Sections` (`shell.sections`), `Assistant` (`nav.assistant`), `FAQ` (`nav.faq`); es — `Plan` (`settings.plan`); de — `Garage` (`garage.title`, `nav.garage`), `Name` (`common.name`), `Plan` (`settings.plan`), `FAQ` (`nav.faq`); pt-BR — none.
- No other identical values remain in a ready locale. `trips.note` → fr `Remarque`, `trips.purpose_personal` → es `Particular`, `common.optional` → de `(fakultativ)` were translated to end their English copies; `nav.docs` (fr) and `nav.admin` (all ready locales) were translated too.

## 3. Machine translation posture

All strings below were produced by machine translation (agent). No translation is claimed final. Each locale block lists what needs native review.

Risky strings (billing, trial, refund, tax, limits, security/2FA, deletion, mixed-currency, PDF disclaimers, email copy) are flagged with `RISK:`.

## 4. Per-locale review lists

### fr (French) — status: needs native review
Confidence: **medium–high**. Formal register `vous` verified throughout including `report-pdf-text.ts` and emails.  
**Identical to English: 12, all excluded (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.trial_ends`, `settings.manage_billing`, `status.past_due/unpaid/canceled`, `error.rate_limited/registration_disabled`
- RISK: `reports.*` PDF labels (`reports.standing_note`, `reports.actual_note`, `reports.pdf_english_warning`, `reports.pdf_locked_title/body`)
- RISK: email copy in `src/lib/email-i18n.ts` (fr): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- Mixed-currency warnings: `common.mixed_currency_title/body`, `insights.mixed_body`, `reports.mixed_body`, `scenarios.mixed_body`
- `scenarios.*`, `dashboard.*` short labels, `category.*` list

### es (Spanish) — status: **pending (not ready)** — needs native review
Confidence: **medium**. Formal register `usted` verified; Iberian-flavored; confirm date/number contexts and some Latin American alternatives.  
**Identical to English: 9, all excluded (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.plan`, `status.*`, `error.*`
- RISK: email copy (es): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- RISK: PDF disclaimers and table headers (`reports.*`)
- Mixed-currency warnings (`common.mixed_currency_*`, `insights.mixed_body`, `scenarios.mixed_body`, `reports.mixed_body`)
- `scenarios.*`, `insights.*`, `dashboard.*`

### pt-BR (Brazilian Portuguese) — status: **pending (not ready)** — needs native review
Confidence: **medium**. Formal register `você` verified.  
**Identical to English: 8, all excluded (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.manage_billing`, `status.*`, `error.*`
- RISK: email copy (pt-BR): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- RISK: PDF labels (`reports.*`)
- Vehicle/garage terminology: `garage.*`, `fuel.*`, "quilometragem"` in `common.distance`, `settings.distance`
- Mixed-currency warnings

### de (German) — status: **pending (not ready)** — needs native review
Confidence: **medium**. Formal register `Sie` verified.  
**Identical to English: 13, all excluded (0 copies).**

Key areas needing review:
- RISK: billing/trial/refund — `settings.trial_ends`, `status.*`, `error.*`
- RISK: email copy (de): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`
- RISK: PDF disclaimers (`reports.*`)
- Compound nouns: `Wertminderung/Abwertung`, `Kraftstoffverbrauch` (`fuel.*`), `Kilometerstand` in `reports.distance_driven`
- Mixed-currency warnings

### ar (Arabic) — status: **pending (not ready)**
COMMIT B has replaced the English mirror with a full formal-Modern-Standard-Arabic translation (`ar.json`, 478/478 keys, placeholder parity, no English copies). The RTL layout (logical CSS, mirrored arrows/drawers, `<bdi dir="ltr">` LTR embeds, Arabic-aware font fallbacks) is delivered and `dirFor("ar")` returns `rtl`; the *emails* ship an Arabic set and a `dir="rtl"` UTF-8 document wrapper, all gated behind `LOCALE_STATUS`. `ar` stays **`pending`** — not selectable, still renders English in the UI and sends English emails — until a native-speaker review confirms it. The review can be previewed behind the dev-only `PREVIEW_PENDING_LOCALES=1` env var (screenshots use it; inert in production).

Identical to English: **9, all excluded (brands/codes: `AutoEco`, `Financial Twin`, `Ask Your Car`, `ACTUAL`); 0 copies of English.**

Key areas needing review:
- RISK: billing/trial/refund/tax — `settings.*` (`settings.trial_ends`, `settings.manage_billing`, `settings.plan`), `status.*`, `error.*`
- RISK: Arabic email copy in `src/lib/email-i18n.ts` (ar): `paymentFailed`, `trialEnding`, `usageLimitReached`, `signupAttemptNotice`, `subscriptionCanceled`
- RISK: plural-bearing strings — `trips.trip_count_*` (6 categories), `common.months_short`, `trips.plan_allowance`
- Mixed-currency warnings (`common.mixed_currency_*`), `reports.*` disclaimer/labels
- Register/gender consistency across `assistant.*`, `dashboard.*`, `insights.*`

## 5. Pending (explicitly out of scope for COMMIT A translation)
- Marketing sub-pages bodies not covered by the key set (features/docs/FAQ detail pages).
- Calculators (~12 calculators) — remain English.
- **Page conversions shipped in COMMIT A2:** `trips` (list/new/edit), `receipts`, `assistant`, `garage/[id]` now render through `useT()`/`getT()`. Remaining English on those screens is dynamic data prose computed by the backend (the grounded-answer text and its sources in `assistant`, the finance breakdown labels/assumptions in `garage/[id]`) and a handful of `trips`/`receipts` vehicle-name labels assembled from the user's own `nickname + brand + model` data — none of it is fixed interface copy.
- **Fixup commit delta:** the true-cost breakdown **labels** (`twin.breakdown_*`, PDF `component*`) now render through keys everywhere (garage/$id, reports, PDF). The `assumptions` sentences emitted by `finance.ts` remain English prose (deferred). The AI assistant's LLM answers follow the user's locale via the system prompt (fallback English; quoted facts/sources are never translated); its deterministic fallback (`deterministicAnswer`) remains English templates (deferred).
- The 4 trip client components (`TripFormFields`, `NewTripForm`, `EditTripForm`, `TripRowActions`) and the new `ReceiptDeleteForm` are wired to the locale too.
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
- Pending locale (`es`, `pt-BR`, `de`, `ar`) -> renders English (`effectiveLocale`) — UI copy, plural rules and email send path alike. A dev-only `PREVIEW_PENDING_LOCALES=1` flips `effectiveLocale` so a pending locale's content/RTL can be reviewed; it is inert without the env var and never set in production. The screenshot server also sets `NEXT_PUBLIC_PREVIEW_PENDING_LOCALES=1`, the client twin Next needs to keep hydrated client components in agreement with the server render (a server-only flag would render Arabic then flip back to English in the browser).
- Email copy: pending locale (`es`, `pt-BR`, `de`, `ar`) -> English; every shipped locale renders fully (no un-filled `{placeholder}` in subject/text).
- Profile API (`PATCH /api/profile`) rejects any non-ready locale via `StoredLocaleSchema`, so a pending locale can never become a durable preference.

## 8. Verification notes
- `tests/i18n.test.ts` (66 tests): parity (missing/extra/empty/placeholders), identical-value detection with allowlist for ready locales, fallback-to-English, legacy-locale coercion, plural selection (`Intl.PluralRules`) for the ready locales (en/fr) including trips-count forms 0/1/2/5 **plus the six Arabic categories (0,1,2,3-10,few; 11-99 many; 100 other) via `pluralCategory` and the Arabic `trips.trip_count_*` keys**, `dirFor("ar")==="rtl"` (only `ar`), Arabic Latin-digit number/date/money output (`ar-EG-u-nu-latn`), error-code mapping, enum translation, email-copy localization + fallback + full Arabic template set rendered as a `dir="rtl"` UTF-8 document with intact links.
- `tests/profile-locale.test.ts` (5 tests, real DB): PATCH/GET persist locale, pending `ar` rejected, junk locale rejected, LOCALE_STATUS/READY_LOCALES coherence.
- Locale selector exposes only `ready` locales (`en`, `fr`). `es`, `pt-BR`, `de` and `ar` = pending.
- Unknown/legacy locale values fall back to `en`. Direct URL/cookie with pending locale falls back to `en`.
- PDF: fr/es/pt-BR/de translated labels; `ar` uses English PDF with warning only when the PDF cannot render.
- Playwright screenshot capture (`npm run screenshots`, dev server on 127.0.0.1:3210, seeded demo user `demo@autoeco.app`, `ar`+`fr` at desktop 1280x800 and mobile 390x844, 52 PNGs + open-drawer states in `docs/screenshots/` — git-ignored): all 4 runs pass. Every page's `<html dir>`/body direction matches the locale (`rtl` for ar, `ltr` for fr), no horizontal overflow, no page errors, no bounce to `/login`.
- Two pre-existing app bugs surfaced by the capture work and fixed while wiring it up (not i18n regressions): `/settings` returned 500 in dev because a *client-component namespace object* (Forms.tsx `SettingsForms.Profile` etc.) cannot be resolved across the RSC boundary — page now imports the named exports directly; the mobile vehicle-detail page overflowed horizontally because the recent-expenses/fuel grid items kept `min-width:auto` from their tables — the two cards now carry `min-w-0` so the tables scroll inside their `overflow-x-auto` wrapper instead.

## 9. Native review checklist (to complete post-commit)
- [ ] Verify formal register (`vous`/`usted`/`você`/`Sie`/Modern Standard Arabic) in all locales — automated checks cover the five translated locales in tests (`en`/`fr` ready; `es`/`pt-BR`/`de` pending), spot-check naturalness.
- [ ] Review all `RISK:` strings (billing/trial/refund/tax/security/deletion/PDF) per locale block above.
- [ ] Sanity-check email subjects/bodies (`src/lib/email-i18n.ts`) for clarity and no PII leakage.
- [ ] Confirm placeholders preserved and counts/plurals sound natural (Arabic: check `trip_count_*` six forms and noun agreement — the `2 رحلتان` dual nuance included).
- [ ] Approve a pending locale (currently `es`, `pt-BR`, `de`, `ar`): once a native speaker signs off, flip its `LOCALE_STATUS` entry to `"ready"` in `src/lib/i18n.ts`, re-run the verification set, and re-run the screenshot script on production copy.
- [ ] Approve glossary terms for each locale.