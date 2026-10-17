# AutoEco Internationalization Glossary

This glossary is binding for all machine and human-reviewed translations in this repository. It defines product terminology, tone, register and constraints for the i18n work delivered in COMMIT A (and B).

## 1. Goals and scope
- Translate only product UI, emails and PDF labels. Legal pages (`legal/*.md`) remain in English and carry a visible note.
- Every translated string is machine-generated and marked **"needs native review"** per locale (rule 8). No claim of final translation appears in the product.
- Formal register is used everywhere: French `vous`, Spanish `usted`, Brazilian Portuguese `você`, German `Sie`. Arabic (COMMIT B) uses formal Modern Standard Arabic with a gender-neutral reading preferred (see §2.1).
- Brand proper nouns (`AutoEco`, `Pro`, `Pro Plus`, `Family`, `Free`) remain untranslated.
- The `DELETE` confirmation word in the UI forms stays the literal string `DELETE` in all languages (server validates it literally).

## 2. Key terminology (canonical mapping)
| English | fr | es | pt-BR | de | Notes |
|---|---|---|---|---|---|
| Vehicle | Véhicule | Vehículo | Veículo | Fahrzeug | Core entity |
| Garage | Garage | Garaje/Coches | Garagem/Veículos | Garage/Fahrzeuge | Prefer product term "Garage"/"Fahrzeuge" as used in UI |
| Expense | Dépense | Gasto/Gasto de vehículo | Despesa | Ausgabe/Aufwendung | Vehicle expenses |
| Fuel | Carburant/Essence | Combustible | Combustível | Kraftstoff | Fuel entries |
| Trip | Trajet | Viaje/Trayecto | Viagem/Trajeto | Fahrt | Trips |
| Report | Rapport/État | Informe/Reporte | Relatório | Bericht | Cost-of-ownership reports |
| Receipt | Reçu/Justificatif | Recibo/Factura | Recibo/Comprovante | Beleg/Quittung | Receipts |
| Insights | Statistiques/Analyse | Información/Análisis | Insights/Análises | Einblicke/Statistiken | Analytics |
| Financial Twin | Jumeau financier | Gemelo financiero | Gêmeo financeiro | Finanzzwilling | Product name, keep English concept if awkward but translate terms |
| Scenarios / What-If | Scénarios / Hypothèses | Escenarios / ¿Qué pasaría si? | Cenários / E se... | Szenarien / Was-wäre-wenn | UI label uses "What-If Scenarios" |
| Dashboard | Tableau de bord | Panel de control/Tablero | Painel | Dashboard/Übersicht | Common |
| Settings | Paramètres | Configuración/Ajustes | Configurações | Einstellungen | |
| Billing/Subscription | Abonnement/Facturation | Suscripción/Facturación | Assinatura/Cobrança | Abonnement/Rechnung | Billing-sensitive |
| Trial | Essai | Prueba/Periodo de prueba | Teste/Período de teste | Testzeitraum/Probe | Riskiest wording |
| Refund | Remboursement | Reembolso/Devolución | Reembolso/Estorno | Rückerstattung | Riskiest |
| Tax/VAT | Taxes/TVA | Impuestos/IVA | Impostos/ICMS | Steuern/MwSt. | Do not invent tax specifics |
| Odometer/Mileage | Kilométrage | Kilometraje | Quilometragem | Kilometerstand | Units km/mi separate |
| Depreciation | Dépréciation | Depreciación | Depreciação | Wertminderung/Abwertung | ESTIMATE label preserved in source where used |
| Cost per km/mi | Coût au km/mi | Coste por km/mi | Custo por km/mi | Kosten pro km/mi | |
| ACTUAL/ESTIMATE/FORECAST | ACTUAL/ESTIMATE/FORECAST | ACTUAL/ESTIMATE/FORECAST | ACTUAL/ESTIMATE/FORECAST | ACTUAL/ESTIMATE/FORECAST | Status labels kept as product codes in many places (translate only when UI says the word) |
| Mixed-currency | Devises mixtes | Divisas mixtas | Moedas mistas | Gemischte Währungen | |
| Plan (Free/Pro/Family/Pro Plus) | Plan (Free/Pro/Family/Pro Plus) | Plan (Free/Pro/Family/Pro Plus) | Plano (Free/Pro/Family/Pro Plus) | Plan (Free/Pro/Family/Pro Plus) | Proper nouns/plan names unchanged |
| Locale/language | Langue/Paramètre régional | Idioma/Configuración regional | Idioma/Localidade | Sprache/Region | UI term "Language/Locale" |

### 2.1 Arabic (ar) — COMMIT B canonical mapping

Arabic uses **formal Modern Standard Arabic (الفصحى)** in the database form, never dialects. Brand proper nouns (`AutoEco`, `Financial Twin`, `Ask Your Car`) and plan names (`Free`, `Pro`, `Pro Plus`, `Family`) stay untranscribed. Third-person or impersonal formal phrasing is preferred over a masculine second person where a gender-neutral reading is possible, but the masculine plural/impersonal form is used for the general "you" per standard MSA UI convention.

| English | ar | Notes |
|---|---|---|
| Vehicle | مركبة / سيارة | `مركبة` for the entity; `سيارة` acceptable in conversational card copy. Prefer `مركبة` in forms and tables. |
| Garage | المرآب / سجل المركبات | Product term `المرآب` (garage list), fall back to `سجل المركبات` if ambiguity |
| Expense | مصروف / نفقة | `مصروف` for an expense record; plural `المصروفات` |
| Fuel | وقود | Fuel entries: `حتائق الوقود` is the tab/`سجل الوقود`; keep `وقود` for the noun |
| Fuel log | سجل الوقود | Tab/page title |
| Trip | رحلة (A) / رحلات (pl) | Trips are a distance/odometer record: `سجل الرحلات` for the page |
| Trip log | سجل الرحلات | |
| Report | تقرير | Cost-of-ownership report |
| Receipt | إيصال | Receipts |
| Insights | الرؤى / التحليلات | Analytics section; prefer `الرؤى` (insights), `التحليلات` for analytics |
| Financial Twin | Financial Twin | Proper noun, never translated/transcribed |
| Ask Your Car | Ask Your Car | Proper noun, never translated/transcribed |
| Scenarios / What-If | السيناريوهات / ماذا لو | |
| Dashboard | لوحة المعلومات | |
| Settings | الإعدادات | |
| Billing/Subscription | الفوترة / الاشتراك | Highest-risk wording (see `docs/I18N_REVIEW.md`) |
| Trial | الفترة التجريبية / تجربة مجانية | Riskiest wording — never promise beyond the actual plan |
| Refund | استرداد المبلغ / استرداد | Riskiest — no invented refund policy |
| Tax/VAT | ضريبة / ضريبة القيمة المضافة | Do not invent tax specifics or VAT rates |
| Odometer/Mileage | عداد المسافة / المسافة المقطوعة | `المسافة المقطوعة` for distance driven |
| Distance unit | وحدة المسافة | km/mi labels stay `km`/`mi` (product units, allowlisted) |
| Depreciation | الاستهلاك (إهلاك القيمة) | `الاستهلاك` for value depreciation; `إهلاك` in financial tables |
| Cost per km/mi | التكلفة لكل km / لكل mi | unit placeholder stays `{unit}`; label keeps unit untranslated |
| ACTUAL / ESTIMATE / FORECAST | تعليمات ثابتة | Status tokens remain the literal codes `ACTUAL`, `ESTIMATE`, `FORECAST` (product codes, allowlisted) |
| Mixed-currency | عملات مختلطة | |
| Plan (Free/Pro/Family/Pro Plus) | الخطة (Free/Pro/Family/Pro Plus) | Plan names are proper nouns, unchanged |
| Subscription | الاشتراك | |
| Upgrade | الترقية / الترقية إلى خطة | `الترقية` for plan upgrades |
| Cancel subscription | إلغاء الاشتراك | |
| Locale/language | اللغة / الإعداد اللغوي | UI term "Language" |
| Debt/overdue | متأخر / غير مسدد | avoid in billing copy unless server field exists |
| Trips purpose — personal | شخصي | |
| Trips purpose — business | عمل | |
| Odometer entry | قراءة العداد | |
| Full tank | تعبئة كاملة / ملأت الخزان بالكامل | |
| Consumption | معدل الاستهلاك | e.g. L/100km |

### 2.2 Arabic script and number rules (ar)
- **Digits:** Latin digits (`0-9`, forced via `ar-EG-u-nu-latn`) for money, odometer readings, distances, dates and any arithmetic number. Never use Arabic-Indic `٠١٢٣٤٥٦٧٨٩` in UI numeric output for this product (they cannot round-trip through arithmetic/PDF).
- **Currency codes stay LTR:** USD, EUR, etc. render left-to-right inside RTL text using `<bdi dir="ltr">` or a LTR wrapper.
- **Calendar:** Gregorian (the product's default). Arabic month/weekday names come from `Intl.DateTimeFormat("ar-EG")`.
- **Plurals (Arabic has 6 categories):** `zero | one | two | few | many | other`. Any string with `{count}` must supply all six forms. Rules (CLDR, as implemented by `Intl.PluralRules("ar")`): 0→`zero`; 1→`one`; 2→`two`; 3–10→`few`; 11–99→`many`; 100→`other`; 103–999→`few` (any `n % 100` in 3..10); all remaining (e.g. 1000, 1100)→`other`. Tests pin 0, 1, 2, 3, 11, 100. `plural()` routes a pending locale through English rules; the raw categories are exercised via `pluralCategory`.
- **Bidi:** numbers and `km`/`mi` units embedded in RTL sentences must read correctly; use explicit LTR wraps where the value contains digits.
- **No Latin transliteration of Arabic text anywhere** (e.g. `al-muraaf`). This is a quality gate in review.

## 3. Tone, register and punctuation
- Formal, clear, concise (CLI/UI context). Avoid colloquialisms, humor, marketing superlatives.
- Use formal second person: `vous`, `usted`, `você`, `Sie`. Never informal (`tu`, `tú`, `du`).
- Use sentence case as in English where natural; preserve product capitalization patterns.
- Numbers: use locale-appropriate decimal/thousand separators in display (handled by `Intl.NumberFormat`), but placeholder text must not assume separators. Currency comes from user settings.
- Dates: locale-aware via `Intl.DateTimeFormat` (no hard-coded MM/DD/YYYY strings in UI copy except where ISO required).
- For Arabic (B): use Latin digits via `nu-latn` for money, odometer, distances (as specified). Currency codes stay LTR.

## 4. Placeholders and interpolation
- All `{name}`, `{email}`, `{count}`, `{unit}`, `{date}`, `{price}`, `{currencies}`, `{listed}`, `{total}`, `{n}`, `{resale}` etc. must be preserved exactly with identical names.
- Never reorder placeholders. Never translate placeholder names.
- Pluralization: expect ICU-style forms where `{count}` is present (French/Spanish/Portuguese/German have standard plural rules). Strings with counts must be written to support plural forms in the final translation; for this commit the key structure is flat strings but any future ICU must remain compatible.

## 5. Allowlist (values considered "not a copy of English")
The parity test (`tests/i18n.test.ts`) treats the following as allowed to be identical to English in a READY locale:

- **`IDENTICAL_ALLOWLIST` — strict, contains ONLY brand names, numbers, symbols and units:**
  - Brand/product proper nouns (never translated): `AutoEco`, `Financial Twin`, `Ask Your Car`
  - Units and code tokens that must remain identical: `km`, `mi`, `DELETE`, `ACTUAL`, `ESTIMATE`, `FORECAST`
  - Pure numeric/symbolic strings (deci-mal amounts, unit ratios) — matched by regex `^[\d.,\s%+\-/()]*[\d][\d.,\s%+\-/()]*$`
- **`IDENTICAL_NATIVE_WORDS` — separate, documented exception for the rare words whose correct translation is literally the same word/acronym in that language** (each with its per-locale justification):
  - `Garage` — fr `garage.title`, `nav.garage`; de `garage.title`, `nav.garage` (native word in French and German)
  - `Date` — fr `common.date` (native French)
  - `Distance` — fr `common.distance`, `dashboard.badge_distance` (native French)
  - `Sections` — fr `shell.sections` (native French plural)
  - `Assistant` — fr `nav.assistant` (native French)
  - `Name` — de `common.name` (native German)
  - `Plan` — es `settings.plan`, de `settings.plan` (native Spanish/German)
  - `FAQ` — fr `nav.faq`, de `nav.faq` (universal Latin acronym)
- Placeholders only (but value length>0 required)

Everything else identical to English was translated instead of allowlisted, e.g. `trips.note` → fr `Remarque`, `trips.purpose_personal` → es `Particular` (`Pessoal` pt, `Privat` de), `common.optional` → de `(fakultativ)`, `nav.docs` → fr `Documentation`, `nav.admin` → fr `Administration`, es `Administración`, pt `Administração`, de `Verwaltung`.

Plan names (`Pro`, `Pro Plus`, `Family`, `Free`) are proper nouns and remain untranslated; they do not currently appear as bare values in the locale files. No other phrase may be silently identical to English for a `ready` locale (enforced by a failing test, not a warning). Only `en` and `fr` are `ready`; `es`, `pt-BR`, `de` and `ar` carry full real translations but stay `pending` in `LOCALE_STATUS` until a native-speaker review is confirmed — see `docs/I18N_REVIEW.md`.

## 6. Risky strings (must receive heightened review)
High-risk domains: billing/subscription, trial, refund, tax wording, legal/eligibility language, plan limits, security/2FA, data deletion, mixed-currency warnings, PDF disclaimers. These appear in settings/billing, emails, reports/PDF. Each is listed per locale in `docs/I18N_REVIEW.md` with confidence.

## 7. Machine translation posture
All translations present are machine-generated (agent). Status per locale: `needs native review`. This document is the source of truth for that posture.
