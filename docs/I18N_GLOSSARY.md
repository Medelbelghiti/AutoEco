# AutoEco Internationalization Glossary

This glossary is binding for all machine and human-reviewed translations in this repository. It defines product terminology, tone, register and constraints for the i18n work delivered in COMMIT A (and B).

## 1. Goals and scope
- Translate only product UI, emails and PDF labels. Legal pages (`legal/*.md`) remain in English and carry a visible note.
- Every translated string is machine-generated and marked **"needs native review"** per locale (rule 8). No claim of final translation appears in the product.
- Formal register is used everywhere: French `vous`, Spanish `usted`, Brazilian Portuguese `você`, German `Sie`. Arabic (COMMIT B) uses formal Modern Standard Arabic.
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

Plan names (`Pro`, `Pro Plus`, `Family`, `Free`) are proper nouns and remain untranslated; they do not currently appear as bare values in the locale files. No other phrase may be silently identical to English for a `ready` locale (enforced by a failing test, not a warning). `ar` is exempt while `pending` (full mirror).

## 6. Risky strings (must receive heightened review)
High-risk domains: billing/subscription, trial, refund, tax wording, legal/eligibility language, plan limits, security/2FA, data deletion, mixed-currency warnings, PDF disclaimers. These appear in settings/billing, emails, reports/PDF. Each is listed per locale in `docs/I18N_REVIEW.md` with confidence.

## 7. Machine translation posture
All translations present are machine-generated (agent). Status per locale: `needs native review`. This document is the source of truth for that posture.
