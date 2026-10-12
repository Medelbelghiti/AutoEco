# AutoEco — Go-live checklist

Two things answer "are we live yet":

- `npm run check:launch` — the automated gate. It scans for unresolved legal
  placeholders, missing required env and unlaunchable config. **This is the
  source of truth; when it exits 0, the code/config gate is green.**
- This document — the human checklist of things only you can do (provider
  accounts, DNS, legal sign-off) and the order to do them in.

Legend: **[code]** already done in the app · **[you]** needs your action.

---

## 0. Code & config gate — done

- [x] **[code]** `npm run typecheck`, `npm run lint`, `npm test` (443/443,
  40 files) and `npx next build` are green.
- [x] **[code]** `prisma migrate diff` reports no drift against the schema.
- [x] **[code]** `npm run check:launch` passes every check **except** the legal
  placeholders (deliberately deferred to §7).
- [x] **[code]** Local production HTTP smoke test passes (29/29):
  `npx next build && node scripts/smoke.mjs`.
- [x] **[code]** Paddle webhook dry-run passes every lifecycle step:
  `node scripts/paddle-dry-run.mjs`.
- [ ] **[you]** Re-run all of the above once on `main` after this PR merges.

---

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

Copy from `.env.example`. Set for **Production** (and Preview if you want
previews to work).

### Required to boot / function
- [ ] `DATABASE_URL` — Neon **pooled** connection string.
- [ ] `DIRECT_URL` — Neon **direct** (non-pooled) string, used only by
      `prisma migrate`. Without it `migrate deploy` can hang with P1002.
- [ ] `AUTH_SECRET` — 32+ chars.
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] `NEXT_PUBLIC_APP_URL` — the real `https://` origin.
- [ ] `CRON_SECRET` — 16+ chars; must match what Vercel Cron sends.

### Paddle (see §3)
- [ ] `PADDLE_ENV` = `live` (set to `sandbox` until §3 is fully tested).
- [ ] `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_SELLER_ID`.
- [ ] `PADDLE_PRO_PRICE_ID`, `PADDLE_FAMILY_PRICE_ID`,
      `PADDLE_BUSINESS_PRICE_ID` (the latter = the `pro_plus` price).
- [ ] `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV` (must match
      `PADDLE_ENV`).

### Email (see §4)
- [ ] `EMAIL_PROVIDER` = `smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`,
      `SMTP_USER`, `SMTP_PASS`.

### Receipt storage (see §5)
- [ ] `STORAGE_DRIVER` = `s3` plus `S3_*` (or a mounted volume for `local`).

### Abuse / optional
- [ ] `CAPTCHA_PROVIDER` = `turnstile`, `TURNSTILE_SECRET_KEY`,
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- [ ] `SENTRY_DSN` (optional; app is fully functional without it).
- [ ] `ANALYTICS_ENDPOINT` — only set after publishing an analytics notice
      (§7).

### Must **not** be set in Production
- [ ] `ALLOW_TEST_DB_WRITES` is **unset** (it permits writes to a remote DB
      during tests).
- [ ] `PREVIEW_PENDING_LOCALES` / `NEXT_PUBLIC_PREVIEW_PENDING_LOCALES` are
      **unset** (developer-only Arabic preview).
- [ ] No `STRIPE_*` variables (Stripe was removed).
- [ ] `PADDLE_LIFETIME_PRICE_ID` is **unset** (lifetime is not sold).

---

## 2. Database (Neon)

- [ ] Provision the Neon project and copy both connection strings.
- [ ] Migrations run automatically during the Vercel build
      (`scripts/build-with-migrate.js` → `prisma migrate deploy`). Confirm the
      first production deploy log shows the migrations applying.
- [ ] Seed the plans (required — the app ships no plan rows): run
      `npm run prisma:seed` against production once, or `node` the
      `scripts/seed-plans.ts` path. `seed-plans.ts` is idempotent and plans-only.
- [ ] Confirm `/api/health` reports the DB check `ok` on the deployed URL.
- [ ] Confirm Neon backups / point-in-time restore are enabled.

---

## 3. Paddle (production payment provider)

Only monthly Pro / Family / Pro Plus are sold. Lifetime is intentionally not
offered.

- [ ] Complete Paddle **seller verification** (business + bank details).
- [ ] Create the three **products/prices** (monthly) and copy their price ids
      into `PADDLE_*_PRICE_ID`.
- [ ] Copy the API key, webhook signing secret and seller id.
- [ ] Add the webhook endpoint: `https://<domain>/api/paddle/webhook`.
      Subscribe to: `subscription.created`, `subscription.updated`,
      `subscription.activated`, `subscription.paused`, `subscription.resumed`,
      `subscription.canceled`, `subscription.expired`, `subscription.past_due`,
      `subscription.payment_failed`, `transaction.completed`,
      `transaction.payment_failed`, `transaction.refunded`,
      `adjustment.created`, `adjustment.updated`.
- [ ] **Sandbox first.** With `PADDLE_ENV=sandbox` + sandbox keys, walk the full
      cycle: checkout → renewal → failed payment → `past_due` grace → recovery →
      cancel → refund. Confirm each change is reflected in Settings → Billing.
- [ ] Verify the webhook signature is accepted (deliveries show 2xx in the
      Paddle dashboard) and a forged request is rejected (the automated
      `scripts/paddle-dry-run.mjs` proves the logic locally).
- [ ] Only then flip `PADDLE_ENV=live` and `NEXT_PUBLIC_PADDLE_ENV=live`, and
      swap in the live keys.
- [ ] Archive any old lifetime price in the Paddle catalog so it can never be
      purchased (a stale price id grants nothing and is audited, but it should
      not be shoppable).

---

## 4. Email

- [ ] Pick an SMTP provider and create DKIM, SPF and DMARC records for the
      sending domain.
- [ ] Set the `SMTP_*` + `EMAIL_FROM` variables.
- [ ] Send a real signup and a password reset; confirm both arrive (not in
      spam) and that the links work.
- [ ] `/api/health` should no longer report the email check as degraded.

---

## 5. Receipt / document storage

- [ ] Provision an S3-compatible bucket (AWS S3 or Cloudflare R2).
- [ ] Set `STORAGE_DRIVER=s3` and the `S3_*` variables (R2 needs
      `S3_REGION=auto` and `S3_ENDPOINT`).
- [ ] Upload a receipt on the deployed app, redeploy, and confirm the file is
      still downloadable (proves persistence).
- [ ] Without S3, uploads are **refused** on Vercel (ephemeral filesystem) —
      this is intentional, not a bug.

---

## 6. Domain, SEO, headers

- [ ] Attach the custom domain in Vercel and set `NEXT_PUBLIC_APP_URL`.
- [ ] Confirm HTTPS works and HSTS is present.
- [ ] Confirm `/robots.txt` and `/sitemap.xml` resolve to the real domain.
- [ ] Keep the CSP as **Report-Only** for the first week. Watch
      `/api/csp-report` (and the browser console). When it is clean, rename the
      header key in `next.config.mjs` from
      `Content-Security-Policy-Report-Only` to `Content-Security-Policy` to
      enforce. This is a one-line change + redeploy. **Do not enforce before
      confirming a real Paddle checkout still opens**, since Paddle.js loads an
      iframe + XHR.

---

## 7. Legal (the current `check:launch` blocker)

See `docs/LEGAL_TODO.md` for the exhaustive list. Minimum before charging money:

- [ ] Fill every `[BRACKETED]` placeholder in `legal/*.md`
      (`[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]`, `[CONTACT EMAIL]`,
      `[PRIVACY EMAIL]`, `[BILLING EMAIL]`, `[ABUSE EMAIL]`,
      `[AFFILIATE EMAIL]`).
- [ ] Lawyer review of Terms, Privacy, Refund policy, AUP, Affiliate terms.
- [ ] Publish the privacy/analytics/cookie notice before enabling any
      third-party analytics.
- [ ] `npm run check:launch` exits 0.

---

## 8. Post-deploy verification (do these on the live URL)

- [ ] `GET /api/health` returns 200 and every check (including `cron`) is `ok`.
- [ ] Sign up with a real mailbox; receive the verification email.
- [ ] Create a vehicle, an expense and a receipt; refresh; data persists.
- [ ] Log out, log back in; log out of all devices from Settings → Security.
- [ ] Buy Pro with a **live** card (small amount), confirm the plan upgrades
      without a manual step, then refund it in Paddle and confirm downgrade.
- [ ] Confirm the three Vercel Cron jobs ran (Vercel → Logs/Cron) and returned
      200.
- [ ] Confirm an invoice appears in Settings → Billing with the correct currency
      and amount.
