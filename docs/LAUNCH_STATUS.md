# AutoEco — Launch status (replaces the old "PRODUCTION_STATUS: READY" docs)

The previous AUTOECO_PROGRESS.md / FINAL_PRODUCTION_AUDIT.md described the Stripe
era and declared the product READY. They were stale and are removed.
`npm run check:launch` is the live source of truth for blockers.

## Fixed in this pass (code)
- **Billing math**: Paddle `grand_total` is already in minor units (was multiplied by 100 -> invoices 100x too big). Invoice currency no longer coerced to USD.
- **past_due grace** was inverted (access revoked the moment a renewal failed). Now 14 days AFTER the period end.
- **Out-of-order Paddle webhooks**: `Subscription.lastEventAt` ignores stale events (a late `updated` can no longer resurrect a canceled sub).
- **Paddle self-service**: new `lib/paddle-api.ts`; cancel / resume / customer portal now work for Paddle customers (they were Stripe-only, and `Paddle.CustomerPortal.open` does not exist in Paddle.js).
- **Account deletion** cancels Paddle subscriptions first (aborts if the provider call fails) so deleted users are never billed.
- **Sessions**: `User.sessionVersion` revokes all JWTs on password change/reset.
- **Abuse**: rate limits on forgot/reset password; Turnstile on signup (activates when keys are set); trial entitlements require a verified email; `/api/track` limiter is now shared (DB) instead of per-instance memory; client IP prefers platform headers.
- **Uploads**: refuse uploads on serverless without a persistent `STORAGE_DIR` (receipts were silently lost on every deploy); magic-byte check vs declared MIME; downloads served with `sandbox` CSP.
- **Schema drift fixed**: `User.lemonCustomerId`, `Subscription.lemonSubscriptionId` and `Invoice.lemonOrderId` were declared in `schema.prisma` but created by no migration, so a freshly migrated database disagreed with the Prisma Client. Migration `20261005130000_add_lemon_identifiers` closes the gap; `prisma migrate diff --from-migrations --to-schema-datamodel` now exits 0.
- **Seed fixed**: `prisma/seed.ts` wrote `fuelEconomyText` on `VehicleCatalogEntry`, which only exists on `Vehicle` — Prisma rejected it and the seed always aborted before creating the admin.
- **Tracking failures are visible**: `/api/track` swallowed every write error; it now logs them (a silent catch made a total persistence failure look like a working funnel).
- **Honest marketing**: receipt scanning, family sharing and API access are marked "Coming soon" (they are not implemented); the Family plan is hidden until sharing exists (`UNAVAILABLE_PLAN_KEYS` in `lib/plans.ts`).
- **Global**: 35 two-decimal currencies (JPY/KWD-style currencies intentionally excluded until minor-unit handling exists); currency selects use the shared list.
- **Legal pages** render real Markdown instead of a raw `<pre>`.
- **Deps**: Next 14.2.35, nodemailer 10, removed unused `xlsx`.
- **Headers**: CSP shipped as Report-Only (enforce after a week of clean console reports).
- **CI** now runs the real-Postgres concurrency/webhook tests (they were skipping).

## Still BLOCKING launch (cannot be fixed in code)
1. Legal entity + `[BRACKETED]` placeholders in `legal/*.md` (run `npm run check:launch`). Needs a lawyer / your company details.
2. Paddle: complete seller verification, create products/prices, set `PADDLE_*` + `NEXT_PUBLIC_PADDLE_*`, `PADDLE_ENV=live`, webhook endpoint. Test the full cycle in sandbox first (checkout, renewal, failed payment, cancel, refund).
3. Email: `EMAIL_PROVIDER=smtp` + domain SPF/DKIM/DMARC. Verification + reset emails currently reach nobody.
4. Persistent receipt storage (S3/R2 or mounted volume) before re-enabling uploads on Vercel.
5. Custom domain; update `NEXT_PUBLIC_APP_URL`.
6. Rotate any secrets that were ever committed (see git history) and enable secret scanning.
7. ~~Run `npx prisma migrate deploy` and `npm test` against a real Postgres.~~
   **Done**: verified against a local PostgreSQL (17.4) — 9 migrations applied,
   `migrate diff` reports no drift, typecheck/lint/build green, 139/139 tests
   pass with the real-DB integration tests actually running (previously skipped).

## Verified, do not regress
- `tests/paddle-billing.test.ts` — real Paddle Billing payloads through the real
  webhook handler: `grand_total: "699"` → `amountCents = 699` with the real
  currency kept; an out-of-order `subscription.updated` cannot resurrect a
  canceled subscription and writes a `paddle.webhook.stale_event_ignored` audit
  row; `past_due` never flips a canceled subscription back; sandbox vs live base
  URL, bearer header, `effective_from`, and no provider error body leaked.
- `tests/auth-hardening.test.ts` — `change-password` and `reset-password` revoke
  previously issued JWTs via `User.sessionVersion` (the current device keeps
  working); `forgot-password` allows 3 reset emails per mailbox per hour and the
  4th request returns the same 200 body with no email, identically for existing
  and unknown addresses; account deletion calls `cancelPaddleSubscription`
  *before* anonymising and returns 502 leaving the account intact when the
  provider fails.

## Known gaps / next
- ~~Stripe code is still present as a legacy fallback~~ Removed in 2.2: no
  Stripe subscribers exist, so `lib/stripe*.ts`, the Stripe webhook route and
  the `stripe` dependency are gone. The DB columns are kept untouched.
- ~~Account enumeration: signup returns 409 for existing emails~~ Fixed in 2.4:
  signup returns the same envelope as a real signup and notifies the owner.
- OCR, family sharing, API access, PDF reports: not built.
- Only EN/FR UI; `dirFor()` always returns ltr (no RTL).
- No annual plans yet (needs Paddle yearly prices + `YEARLY` plan rows).
- `npm audit` still reports advisories whose fix is a major upgrade (Next 15/16, Tailwind 4, Vitest 5 dev-only).
- ~~The cookie is still named `lg_session` and API keys use `lgk_`~~ Rotated in
  2.4 to `autoeco_session` / `aek_`; the legacy names are still accepted on read
  for one release, so existing sessions and keys keep working.
- ~~Errors were only visible in the platform log~~ Instrumented in 2.5:
  `captureException()` now also forwards to Sentry when `SENTRY_DSN` is set, and
  stays completely inert — no import, no network call — when it is empty. Events
  are scrubbed by allowlist before leaving the process (no emails, tokens, or
  nested objects), so no DSN is needed to keep the adapter privacy-safe. The DB
  sink now writes through `db` directly, because `auditLog()` swallows its own
  errors and would have hidden a failed insert; a stale `userId` is retried
  un-attributed rather than losing the record. CSP reports reach the same sink.
- Remaining observability gap: no source maps are uploaded, since the adapter is
  a hand-rolled envelope POST rather than `@sentry/nextjs`. Stack traces arrive
  minified. Adding the vendor SDK is a contained change if that becomes a
  problem. `SENTRY_DSN` is still unset in every environment, so no event has
  been confirmed against a live project.
- The webhook concurrency test asserted that exactly one worker finalizes an
  all-failures race. That only holds while every worker claims before the winner
  marks the event `FAILED`; after that the row is legitimately claimable again,
  which is how retries work. Made deterministic by separating the claim phase
  from the finalize phase, testing the guarantee that actually exists: one
  winner at claim time, and only the token holder may finalize.

## Mileage trip log (3.3)
Logged distances, per-year totals and a CSV export, so a user can keep a mileage
record without AutoEco claiming to know anything about their tax position.
- A distance is entered either as an odometer pair or as a number. Mixing the
  two is rejected rather than resolved by preference, and a value with more than
  two decimals is refused instead of rounded.
- The deduction rate is the user's own figure for their jurisdiction. It is
  stored on the profile together with its currency and unit, and copied onto
  each trip as it is logged, so changing the rate later never restates a trip
  that may already be filed. A rate is never applied to a distance in a unit it
  was not set for, and a trip whose unit would invalidate its recorded rate
  cannot be edited in place.
- Totals are grouped per calendar year in UTC, per distance unit, and per
  currency. Nothing is converted between km and miles and no two currencies are
  ever added together. When a rate is unset, the UI says so rather than
  implying a figure is missing or zero.
- Quota is `Plan.maxTripsPerMonth` (free 25, pro 500, family 1000, pro_plus
  5000), reserved atomically and released if the insert fails. Deleting a trip
  returns the slot to the month the trip belongs to, not the current month.
- Known bounds: the list page shows the 500 most recent trips and says so, and
  the summary aggregates at most 5000 rows.
