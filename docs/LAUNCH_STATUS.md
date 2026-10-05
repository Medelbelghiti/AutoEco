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
7. Run `npx prisma migrate deploy` (2 new additive migrations) and `npm test` against a real Postgres.

## Known gaps / next
- Stripe code is still present as a legacy fallback; remove once no Stripe subscribers exist.
- OCR, family sharing, API access, PDF reports: not built.
- Only EN/FR UI; `dirFor()` always returns ltr (no RTL).
- No annual plans yet (needs Paddle yearly prices + `YEARLY` plan rows).
- Account enumeration: signup returns 409 for existing emails.
- `npm audit` still reports advisories whose fix is a major upgrade (Next 15/16, Tailwind 4, Vitest 5 dev-only).
- The cookie is still named `lg_session` and API keys use `lgk_` (old product name).
