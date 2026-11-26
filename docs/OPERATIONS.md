# Operations

Operational notes for running AutoEco in production.

## `GET /api/health`

Liveness + configuration readiness probe. Safe to hit from uptime monitors.

- **Healthy** (database reachable and schema matches the code): `200`.
- **Unhealthy** (database unreachable, or a required `information_schema`
  column is missing): `503`.
- **Degraded** (email transport, Whop credentials, cron secret, storage not
  configured): still `200` — the app serves requests fine; the missing
  dependency is listed in the detailed report.

### Access

By default the endpoint is anonymous and returns **only** a single boolean so
that public monitors cannot use it for reconnaissance:

```json
{ "ok": true }
```

`{ "ok": false }` is returned with `503` when unhealthy.

The full per-dependency report is available to callers that present the shared
secret:

```
Authorization: Bearer <HEALTH_SECRET>
```

The detailed report includes `status`, `checks`, `degraded`, and — with
`?verbose=1` — the production configuration warnings.

`HEALTH_SECRET` is **optional**:

- **Set it** to allow your own tooling (and only your tooling) to see the
  detailed report. Generate a value with:

  ```sh
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- **Leave it unset** to disable the detailed view for everyone.

The secret is compared in constant time and is never written to logs or echoed
in any response. Rotating it (or removing it) takes effect immediately — no
restart required.

### What is never disclosed

Even the authorized report contains no secret values, no connection strings, no
database hostnames, and no object-storage bucket name or endpoint host. The
storage check reports *which configuration keys are missing*, not their values.

### Performance

Each dependency probe is bounded by a short timeout (~2s) and the database
round trips run concurrently, so a single slow query cannot hold the request
open.

## Canonical origin

There is exactly one canonical origin: `https://www.myautoeco.com`.

Two environment variables name it:

| Variable               | Used for                                                        |
| ---------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | Preferred source of the origin (SEO + links).                    |
| `NEXT_PUBLIC_APP_URL`  | Same origin; also the fallback when `SITE_URL` is unset.         |

They are **two names for the same origin**. Do not point them at different
hosts.

### Set both to the canonical host

In the production (Vercel) environment set BOTH variables:

```
NEXT_PUBLIC_APP_URL=https://www.myautoeco.com
NEXT_PUBLIC_SITE_URL=https://www.myautoeco.com
```

Locally you can leave `NEXT_PUBLIC_SITE_URL` empty; the app falls back to
`NEXT_PUBLIC_APP_URL` (or `http://localhost:3000`).

### Why this cannot drift

The origin is resolved in exactly one place — `siteOrigin()` / `appOrigin()` in
`src/lib/seo.ts`. Everything that needs an absolute origin reads from there:

- **SEO**: `src/app/layout.tsx` (`metadataBase`), `src/app/sitemap.ts`,
  `src/app/robots.ts`, and every `pageMeta()` canonical / Open Graph URL.
- **Emails**: verification, password reset, welcome, trial and payment emails
  all build links with `appOrigin()` / `emailVerifyUrl()` / `passwordResetUrl()`.

Because both SEO and the mailers read the same helper, a mismatch between
`APP_URL` and `SITE_URL` cannot produce a canonical `myautoeco.com` URL next to a
reset link on a different host. `tests/canonical-origin.test.ts` pins this.

### Reply-To

Set `EMAIL_REPLY_TO` to a monitored mailbox (for example
`support@myautoeco.com`) to add a `Reply-To` header to every outgoing message.
When it is empty the header is omitted, and replies go to `EMAIL_FROM` as
before. Read live from `process.env`; no redeploy is needed to change it.
`tests/email-reply-to.test.ts` covers both states.

### Apex ↔ www

The apex domain (`myautoeco.com`) redirecting to `www` is an **edge / DNS**
concern. It is intentionally **not** implemented in application code
(`next.config.mjs` and `src/middleware.ts` do not rewrite the host). Configure
the redirect at your DNS / hosting provider if you want it.

## Free trial semantics

Keep the product and the legal copy in agreement:

- 14-day free trial with expanded limits.
- **No card required.** You are never charged automatically.
- It starts **after the user verifies their email** (trial entitlements are
  granted only once the email is verified).
- When it ends, the account returns to the **Free** plan.

The trial does grant Ask Your Car (25 grounded questions/month:
`src/lib/plans.ts`, gated by `ent.aiConversationsPerMonth` in
`src/app/api/ai/route.ts`). The same wording is used on `/pricing`, in the FAQ,
the Terms (§4) and the Refund Policy (§3).

## Payments — Whop

Whop sells the two recurring plans (**Pro**, **Pro Plus**) and the one-time
**Founder Lifetime** (same limits and monthly quotas as Pro). It replaced
Paddle (rejected) and PayPal (never switched on) in 2.5. Payments are
processed by Whop. We do not store your card details.

### Configuration (server side only)

| Variable | Meaning |
| --- | --- |
| `WHOP_API_KEY` | **Secret.** Company API key (Developer → API keys). Needs the checkout configuration, membership and payment permissions. |
| `WHOP_WEBHOOK_SECRET` | **Secret.** The webhook signing secret (`ws_...`), shown once. |
| `WHOP_COMPANY_ID` | Company id (`biz_...`). |
| `WHOP_PRO_PLAN_ID` | Whop plan id (`plan_...`) for Pro — 6.99 USD every 30 days. |
| `WHOP_PRO_PLUS_PLAN_ID` | Whop plan id for Pro Plus — 19.99 USD every 30 days. |
| `WHOP_LIFETIME_PLAN_ID` | Whop plan id for Founder Lifetime — 99.00 USD one-time. |
| `WHOP_ENV` | `"sandbox"` (default) or `"live"`. Only `live` uses `api.whop.com`. |
| `LIFETIME_MAX_GRANTS` | Lifetime cap. **Default `0` = lifetime offer off.** Set the same stock on the Whop plan. |

**Fail closed.** Without the API key, webhook secret, company id and at least
one plan id, no checkout is shown anywhere and `/api/billing/checkout` answers
503. A plan whose id is empty is simply not sold. Prices shown on the site
come from the seeded `Plan` rows, so the Whop plan prices must match them.

### Flow

1. The buyer clicks a plan; `POST /api/billing/checkout` (verified email
   required) creates a Whop checkout configuration with
   `metadata = { userId, planKey }` and returns its hosted `purchase_url`.
2. The buyer pays on Whop and is sent back to `/settings/billing?checkout=success`.
3. Whop copies the metadata onto the membership and payments, and the webhook
   grants access. Nothing else ever grants access.

### Webhook

- URL: `https://<domain>/api/whop/webhook`
- Events: `membership.activated`, `membership.updated`,
  `membership.deactivated`, `payment.succeeded`, `payment.failed`,
  `refund.created`, `refund.updated`.
- Standard Webhooks signature (`webhook-id`, `webhook-timestamp`,
  `webhook-signature`), HMAC-SHA256 keyed with the literal `ws_...` secret,
  5-minute replay window. Invalid → `401`, audited.
- De-duplicated by `webhook-id` through the shared `WebhookEvent` state
  machine; side effects (emails, notifications) fire once.
- Out-of-order deliveries are ignored using the membership's `updated_at`.
- Whop retries failed deliveries for ~3 days and disables an endpoint that
  keeps failing; re-enable it in the dashboard and reconcile from the API.

### Entitlement & refund rules

- Membership status mapping: `active`/`trialing` → access; `canceling` →
  access until the period end; `past_due`/`unresolved` → bounded grace;
  `canceled`/`expired` (and `completed` for recurring plans) → Free. A
  one-time lifetime membership (`active`/`completed`) → lifetime.
- A plan we do not sell never grants anything (audited as
  `whop.webhook.unmapped_plan`).
- Changing plan creates a new Whop membership; when it activates, the previous
  recurring membership is set to end at its period end, so nobody is billed
  twice (`whop.switch.*` audit rows).
- Refunds: only `succeeded` refunds count, each applied once. A full refund
  of a lifetime payment revokes lifetime; a full refund of the latest payment
  of a subscription ends it immediately at Whop; partial refunds and refunds
  of older payments keep access.
- Account deletion cancels active Whop memberships first and aborts if Whop
  refuses.
- No card data is ever read or stored — only Whop's ids, amounts and status.

### Turning it on (ordered)

1. In the Whop dashboard, create one product with three plans (Pro monthly
   6.99, Pro Plus monthly 19.99, Founder Lifetime one-time 99.00 with stock =
   `LIFETIME_MAX_GRANTS`). Copy the three `plan_...` ids and the `biz_...` id.
2. Create an API key and a webhook to `https://<domain>/api/whop/webhook`
   with the seven events above; copy the `ws_...` secret.
3. Set the `WHOP_*` variables and `LIFETIME_MAX_GRANTS` in Vercel, with
   `WHOP_ENV=sandbox` first (sandbox keys from sandbox.whop.com).
4. Deploy (the build applies the `add_whop_identifiers` migration) and run one
   sandbox purchase, one cancel, and one refund end to end.
5. Switch to live keys, live plan ids and `WHOP_ENV=live`.

## Backups and restore

The production database is the only durable asset: every vehicle, expense,
fuel entry, invoice and webhook state machine row lives there. Nothing else
(objects, files) is durable — receipts are only stored when an S3/R2 bucket is
configured, and that bucket needs its own versioning.

### What backs up what

| Asset | Where it lives | Backup |
| --- | --- | --- |
| Postgres (Neon) | Neon project | Neon's **point-in-time restore** (default: 7 days on Free, configurable on paid) + daily encrypted snapshots |
| Receipt objects | S3 / R2 bucket | Enable **versioning** + lifecycle rules; the provider's own replication is the backup |
| Env vars (secrets) | Vercel project settings | Not backed up by Vercel — keep an offline copy (see below) |
| Source | GitHub | Already durable |

### Weekly offsite dump (belt and braces)

Point-in-time restore is not a substitute for a copy you control. Run this on a
schedule (local shell, or a GitHub Action with the DB URL as a secret):

```sh
# Full logical dump (schema + data). Compressed, timestamped.
pg_dump "$DIRECT_URL" --no-owner --no-privileges --compress=9 \
  -f "autoeco-$(date +%Y-%m-%d).dump"

# Sanity: the dump must list the tables you expect.
pg_restore --list "autoeco-$(date +%Y-%m-%d).dump" | grep -c 'TABLE DATA'
```

`pg_dump` comes with any Postgres client (`brew install libpq`,
`apt install postgresql-client`). Point it at `DATABASE_URL` **or**
`DIRECT_URL` — for Neon, use `DIRECT_URL`, since `DATABASE_URL` is the
pooled connection and is slower for a bulk dump.

Store the dumps somewhere that is not the database provider (encrypted object
storage, or a private repo with a short retention). Test a restore quarterly.

### Restore

```sh
# 1. Restore into a scratch database first — never straight into production.
createdb autoeco_restore
pg_restore --no-owner --no-privileges -d autoeco_restore autoeco-2026-10-18.dump

# 2. Verify row counts against the live database before touching anything.
psql "$RESTORE_URL" -c 'SELECT count(*) FROM "User";'
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "User";'

# 3. Only then point DATABASE_URL / DIRECT_URL at the restored database,
#    or promote the scratch database and update Vercel. Redeploy afterwards
#    so every function picks up the new connection string.
```

After a restore, run `GET /api/health` with `HEALTH_SECRET`: it checks the
migration ledger and the schema, so a half-restored or drifted database is
reported instead of silently serving errors.

### Secrets

Vercel env vars are not versioned. Keep an offline, encrypted copy of
`AUTH_SECRET`, `CRON_SECRET`, `HEALTH_SECRET`, the Whop secrets
and the SMTP credentials, and rotate them if the copy is ever exposed. A lost
`AUTH_SECRET` logs every user out (sessions are JWTs) — it is recoverable by
generating a new one, but do it deliberately, not by accident.
