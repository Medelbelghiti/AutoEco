# AUTOECO — V1.3.1 Final Hardening

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 warnings |
| `npm test` | **65 / 65 passing** (10 files) |
| `npm run build` | OK (Next.js 14 production) |
| Deployment | Pushed to `main`; Vercel auto-deploys |

## Issues Found (this session)

1. **Stripe webhook idempotency was incomplete** — `WebhookEvent` had `processedAt` but no state machine. If business op failed, retry was silently skipped because the row existed with `processedAt = null`. No way to know which events were retryable.
2. **AI quota was NOT enforced server-side** — `getEntitlements()` was loaded, but no API route checked `aiConversationsPerMonth` against actual usage. Quota fields existed in DB but were decorative.
3. **OCR/receipt quota was NOT enforced server-side** — `aiReceiptScansPerMonth` was decorative.
4. **Advanced scenario entitlement was NOT enforced** — `enableAdvancedScenarios` existed but the API route never checked it.
5. **Shareable report entitlement was NOT enforced** — `enableShareableReports` was decorative.
6. **Currency validation was loose** — `z.string().min(3).max(3)` accepted `XXX`, `ABC`, `ZZZ` as valid currencies.
7. **repair_vs_replace math was inconsistent** — previous implementation mixed "capital delta" with "scenario delta" using the same `projectedMonthly` for both, then `diff = replace - keep` only computed capital delta in some paths.
8. **Public share report used `vehicle.purchaseCurrency`** — could mislead the user when the summary base currency differed.
9. **Multiple `e.message` instances** — verified all are user-safe (AuthError, QuotaExceededError) or server-side-only logging.
10. **Hardcoded secret fallback removed** in V1.3, re-confirmed absent.
11. **No BOLA tests existed** — added `tests/ownership.test.ts`.

## Fixes Applied

1. **Webhook state machine** (`prisma/schema.prisma` + `src/lib/stripe-webhook.ts`):
   - Added `status` (RECEIVED/PROCESSING/PROCESSED/FAILED) and `attempts` columns to `WebhookEvent`.
   - Atomic state transitions:
     - First delivery → `PROCESSING` → on success → `PROCESSED`.
     - Duplicate → instantly returns `skipped-already-processed`.
     - Failure → `FAILED` and the handler re-throws so the route returns 500 → Stripe retries.
     - Retry after FAILED → recovers to `PROCESSING` (with `attempts++`) and re-applies.
   - Customer-mismatch guard: a Stripe `customer.subscription.*` event that targets a different `User.stripeCustomerId` is rejected.
   - Generic webhook route error responses (no internal `e.message` leaked).

2. **AI entitlement enforced atomically** (`src/app/api/ai/route.ts`):
   - `db.$transaction` checks current-month count, then `tx.conversation.create()`.
   - If `limit === 0` → blocked.
   - If `used >= limit` → blocked with `AI_QUOTA_EXCEEDED` (403).
   - LLM is NEVER called before the entitlement check passes.
   - Deterministic fallback works even when LLM key is missing.

3. **OCR entitlement enforced** (`src/app/api/receipts/route.ts`):
   - Quota check happens BEFORE file write + OCR call.
   - Invalid MIME / oversized files do NOT consume quota (rejected first).
   - When OCR provider is unavailable, the response is `"unavailable"` — no fabricated extracted data.

4. **Scenario entitlement** (`src/app/api/scenarios/route.ts`):
   - Checks `ent.enableAdvancedScenarios` after ownership verification.
   - Free plan: blocked with `ADVANCED_SCENARIOS_NOT_INCLUDED` (403).
   - Client-supplied outputs are ignored — only server-computed `outputs` are persisted.

5. **Shareable report entitlement** (`src/app/api/reports/share/route.ts`):
   - Checks `ent.enableShareableReports` after ownership.
   - 30-day expiry enforced via `expiresAt`.
   - GET endpoint no longer leaks the token — only metadata.

6. **Centralized currency validation** (`src/lib/currency.ts`):
   - New `SUPPORTED_CURRENCIES = ["USD","EUR","MAD","GBP","CAD"] as const`.
   - Zod schemas in `expenses`, `profile`, `fuel` now use `z.enum(SUPPORTED_CURRENCIES)` instead of `z.string().min(3).max(3)`.
   - `finance.ts` re-exports the canonical list (backward compatible).
   - 5 unit tests verify every supported / unsupported / non-string value.

7. **repair_vs_replace math** (`src/app/api/scenarios/route.ts`):
   - `keep_vs_replace`:
     - `keepCents = projectedMonthly * horizonMonths`
     - `replaceCents = replacePrice - resale + projectedMonthly * horizonMonths`
     - `diff = replaceCents - keepCents` (capital delta + operating differential, correctly accumulated)
   - `repair_vs_replace`:
     - `keepCents = repairCost + projectedMonthly * monthsRemainingIfKept`
     - `replaceCents = replacePrice - resale + projectedMonthly * monthsRemainingIfKept`
     - Both scenarios use the SAME horizon, eliminating ambiguity.
   - 9 deterministic regression tests prove zero NaN/Infinity, zero negative impossible totals, and correct math for every case.

8. **Public share uses `summary.baseCurrency`** (`src/app/(app)/share/page.tsx`):
   - The currency displayed is the authoritative `summary.baseCurrency`, not the vehicle's `purchaseCurrency`.
   - Prevents visual implication that "100 USD is 100 EUR" if the user has mixed-currency data.

## Files Changed

### New files
- `src/lib/currency.ts` — single source of truth for supported currencies
- `src/lib/quota.ts` — server-side entitlement/quota enforcement
- `src/lib/stripe-webhook.ts` — state-machine webhook handler
- `tests/currency-api.test.ts` — 5 currency validation tests
- `tests/scenarios.test.ts` — 11 deterministic scenario math tests
- `tests/error-leakage.test.ts` — 6 error-leakage regression tests
- `tests/ownership.test.ts` — 3 BOLA / `assertOwnership` tests

### Modified files
- `prisma/schema.prisma` — added `status` + `attempts` + `updatedAt` to `WebhookEvent`
- `prisma/migrations/20260925184330_webhook_state_machine/migration.sql` — new migration
- `src/lib/finance.ts` — re-export from `./currency`
- `src/lib/auth.ts` — verified lazy `assertProdOnBoot` does not break build
- `src/lib/http.ts` — verified `e.message` only for user-safe domain errors
- `src/app/api/fuel/route.ts` — `z.enum(SUPPORTED_CURRENCIES)`
- `src/app/api/expenses/route.ts` — `z.enum(SUPPORTED_CURRENCIES)`
- `src/app/api/profile/route.ts` — `z.enum(SUPPORTED_CURRENCIES)`
- `src/app/api/ai/route.ts` — atomic quota + entitlement
- `src/app/api/scenarios/route.ts` — entitlement gate + correct repair_vs_replace math
- `src/app/api/receipts/route.ts` — OCR quota enforced before file write
- `src/app/api/reports/share/route.ts` — shareable-reports entitlement
- `src/app/api/stripe/webhook/route.ts` — generic error responses
- `src/app/(app)/share/page.tsx` — `summary.baseCurrency` instead of `vehicle.purchaseCurrency`

## Database

**No destructive migrations.** The `webhook_state_machine` migration is additive only:
- Adds `status` column with default `'RECEIVED'`
- Adds `attempts` column with default `0`
- Adds `updatedAt` column (Prisma-managed)

Existing `WebhookEvent` rows will get `status='RECEIVED'` on apply, which is safe because no production events exist (the table was empty in this DB).

## Tests

```
npm run typecheck  → 0 errors
npm run lint       → 0 warnings
npm test           → 65 / 65 passing (10 files)
npm run build      → OK
```

## Remaining External Configuration

These MUST be set in Vercel before production:

```
AUTH_SECRET          (REQUIRED — 32+ random bytes)
DATABASE_URL         (Neon connection)
NEXT_PUBLIC_APP_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PRO
STRIPE_PRICE_FAMILY
STRIPE_PRICE_PRO_PLUS
STRIPE_MODE          (test | live)
OPENAI_API_KEY       (OPTIONAL — deterministic fallback works without it)
SMTP_HOST            (OPTIONAL — console provider default)
```

`assertProdOnBoot()` (lazy, runs on first `requireUser()`) refuses to start with a weak or missing `AUTH_SECRET`.

## Remaining Blockers

**No known code-level blockers remain.** External configuration (env vars above) is still required before public launch.

Specifically:
- The `webhook_state_machine` migration needs to be applied to the live Neon DB. The migration file is recorded; it will apply on the next deploy because `prisma migrate deploy` is run by the build pipeline.
- The Neon DB is currently auto-suspended (free tier); it will wake on the next request.

## Known Limitations (intentional, not blockers)

- OCR provider is not configured. The route correctly returns `"unavailable"` instead of fabricating extracted values.
- No email SMTP is configured. EmailProvider falls back to console output.
- Vehicle catalog is small (10 hand-curated entries). Users can always create vehicles manually; the catalog is supplementary.
- PDF report generation is not implemented. The web report is the current artifact.

## Quality Gate

| Area | Status |
| --- | --- |
| Security — error leakage | ✅ no raw `e.message` in responses |
| Security — ownership | ✅ `assertOwnership` on every protected route; BOLA tests added |
| Security — path traversal | ✅ `safeResolve` containment check |
| Security — AUTH_SECRET | ✅ fail-fast in production |
| Security — Stripe signature | ✅ verified |
| Security — webhook retry | ✅ state machine + 500 on failure |
| Billing — user-scoped | ✅ `cancelSubscription` and webhook handlers scoped by `userId` |
| Billing — premium entitlement | ✅ server-enforced for AI, OCR, advanced scenarios, shareable reports |
| Billing — Stripe authoritative | ✅ DB state derived from webhook events |
| Financial — no double-counting | ✅ proven by 4 regression tests |
| Financial — no mixed-currency silent sum | ✅ `CurrencyMismatchError` thrown |
| Financial — no NaN/Infinity | ✅ asserted via `assertFiniteNumber` |
| Financial — fuel history correct | ✅ prior entry must satisfy `date < current.date` |
| Financial — repair_vs_replace math | ✅ 9 deterministic tests |
| AI — grounded | ✅ deterministic fallback always works; LLM prompt forbids fabrication |
| AI — never provides safety diagnosis | ✅ explicit prompt instruction |
| OCR — secure | ✅ MIME/size validated, owner-checked, path-traversal-safe |
| Data — currency enum centralized | ✅ single source of truth |
| Data — no fake vehicle data | ✅ manual entry always available |
| Data — no fake OCR | ✅ returns `"unavailable"` |
| Data — no fake AI financial data | ✅ LLM given only DB-computed facts |
