# AutoEco — Operations runbook

How to run, watch and repair AutoEco in production. Written for the operator on
call, not for a developer reading the code.

- **Payments:** Paddle (Billing). **Host:** Vercel. **DB:** Neon Postgres.
  **Email:** SMTP. **Storage:** S3-compatible (R2/S3).
- The app is self-hosted logic: there is no separate admin service. Everything
  below uses the app's own routes, logs and database.

---

## 1. Health & monitoring

`GET /api/health` is the single readiness probe. It returns `{ status, checks }`
where every `checks.*.ok` is a **boolean** — no secrets, no connection strings.
It returns **503** when a required dependency is down.

What it checks:

| Check | Meaning | If it fails |
| --- | --- | --- |
| `database` | A trivial query succeeds. | Neon down / bad `DATABASE_URL`. |
| `auth` | `AUTH_SECRET` is present. | Boot will have refused already. |
| `cron` | `CRON_SECRET` set and 16+ chars. | Scheduled jobs fail closed (503/401). |
| `storage` | Persistent storage is configured. | Uploads are refused on Vercel. |
| `email` | A real provider is set (not `console`). | Emails reach nobody. |
| `monitoring` | `SENTRY_DSN` set or local-only. | Optional; never fatal. |

- Configure the platform (or an uptime monitor) to alert on **status 503**.
- **Sentry** is optional: set `SENTRY_DSN` to forward scrubbed error events. With
  it unset, errors still go to the platform log and the `AuditLog` table.
- The **`AuditLog` table** is the durable record of security-relevant and
  billing-relevant events. When something is wrong, it usually says so here.

### Useful audit actions to search for

| Action | Means |
| --- | --- |
| `paddle.webhook.unresolved_customer` | A payment could not be matched to a user. **Investigate.** |
| `paddle.webhook.unmapped_price_id` | A price not in our catalog was charged. Grants nothing. Reconcile by hand. |
| `paddle.webhook.signature_invalid` | Someone POSTed the webhook without the secret. |
| `paddle.webhook.stale_event_ignored` | An out-of-order event was correctly dropped. |
| `paddle.refund.cancel_failed` | A full refund could not cancel the subscription (provider error). **Cancel by hand.** |
| `paddle.refund.no_subscription` | A full refund on a one-off purchase; nothing to cancel. |
| `paddle.payment_failed` | A renewal charge failed; the customer was emailed. |

---

## 2. Deploys

Deploys are driven by Vercel from `main`.

- The build command is `npm run build` → `scripts/build-with-migrate.js`, which
  runs `prisma migrate deploy` before `next build`. **Migrations run on every
  production deploy.**
- If a migration fails, the deploy fails and the previous deployment keeps
  serving. Fix forward; do not hand-edit the database.
- `DIRECT_URL` must be the **non-pooled** Neon string, or migrations can hang
  with P1002.

### Rollback

- Vercel → Deployments → promote the last good deployment ("Instant Rollback").
- **Rolling back code does not roll back migrations.** This is why migrations
  must be backward-compatible (additive) wherever possible.

### Running a migration by hand

```powershell
$env:DATABASE_URL="<neon pooled>"; $env:DIRECT_URL="<neon direct>"
npm run prisma:deploy
```

Never run `prisma migrate dev` against production (it can prompt to reset).

---

## 3. Scheduled jobs (Vercel Cron)

Defined in `vercel.json`; all three are **daily** (Hobby-compatible). Each route
requires `Authorization: Bearer <CRON_SECRET>` and **fails closed** (503 when
the secret is unset, 401 when it is wrong). Both GET and POST are accepted
(Vercel sends GET).

| Route | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/trial-ending` | `0 9 * * *` | Emails users whose trial ends soon. |
| `/api/cron/expire-subscriptions` | `17 3 * * *` | Ends lapsed access / applies expiry. |
| `/api/cron/purge-deleted` | `43 4 * * *` | After `PURGE_AFTER_DAYS` (default 30), removes residual data of deleted accounts. |

- Check Vercel → Cron (or Logs) to confirm they ran and returned 200.
- A **503** from a cron route means `CRON_SECRET` is missing/short — set it and
  redeploy.

---

## 4. Billing incidents

### A payment did not upgrade a customer
1. Search `AuditLog` for `paddle.webhook.unresolved_customer` — the webhook was
   received but could not find the user (should not happen; `custom_data.userId`
   is sent by our checkout).
2. Check the Paddle dashboard → Webhooks → deliveries for that event: is it 2xx?
3. If a price id was involved that is not one of ours, look for
   `paddle.webhook.unmapped_price_id`.
4. As a stop-gap, grant access by writing the correct `Subscription` row / user
   `planId` — then fix the underlying mapping.

### A full refund did not cancel the subscription
- Look for `paddle.refund.cancel_failed`. The invoice is already marked refunded;
  the Paddle cancel API call failed. **Cancel the subscription in the Paddle
  dashboard by hand**, then confirm the customer downgrades (the subsequent
  `subscription.canceled` webhook, or a manual plan change).

### A customer is charged but wants a refund
1. Refund in the Paddle dashboard (full or partial).
2. Paddle sends `adjustment.created`/`adjustment.updated`; the app records the
   refunded amount and, for a **full refund of the latest payment**, revokes
   access by canceling the subscription.
3. Partial refunds and refunds of older invoices keep access — this is intended.

---

## 5. Account & data operations

### Restore a deleted account (within the purge window)
- Deletion is soft first: `User.deletedAt` is set and entitlements stop
  immediately (billing is cancelled first). The `purge-deleted` cron permanently
  removes residual data after `PURGE_AFTER_DAYS`.
- To restore, clear `deletedAt` on the user row **before** the purge runs. After
  the purge, the data is gone.
- Adjust the window with `PURGE_AFTER_DAYS` (minimum 1, default 30).

### Rotate a secret
Set the new value in Vercel and redeploy.
- `AUTH_SECRET`: rotating it invalidates every existing session (all users log
  in again). Acceptable if a leak is suspected.
- `CRON_SECRET`: update Vercel env; Vercel Cron reads it automatically.
- `PADDLE_WEBHOOK_SECRET` / `PADDLE_API_KEY`: rotate in the Paddle dashboard and
  Vercel together.

### Receipts are missing after a deploy
- Almost always `STORAGE_DRIVER=local` on Vercel (ephemeral). Switch to S3/R2.
  Local-disk uploads are intentionally refused on serverless so this cannot
  happen silently.

---

## 6. Local rehearsal (before a risky release)

These boot the **real production build** against a local disposable database and
touch nothing remote. Run them on the release commit:

```powershell
npx next build
node scripts/smoke.mjs          # 29 checks: auth, journeys, PDF, webhook, cron
node scripts/paddle-dry-run.mjs # full Paddle lifecycle with signed fixtures
```

Both scripts never contact Paddle or any remote service and delete the data they
create. See `scripts/README.md` for what each asserts.

---

## 7. Known operational caveats

- **`/api/health` is anonymous.** It exposes only booleans, but on failure the
  underlying DB error message, the bucket name and the S3 endpoint can appear in
  the check details. Treat the endpoint as semi-public and consider putting it
  behind the platform's access controls if that is a concern.
- **CSP is Report-Only**, so violations are logged (via `/api/csp-report`) but
  not blocked. Enforce it after a clean week, and only after confirming a live
  Paddle checkout still works.
- **`npm audit`** currently reports advisories whose fix is a breaking major
  upgrade (Next.js / AVIF RCE class). The Windows-hosted Next.js advisory is not
  applicable on Vercel's Linux runtime. Track these; do not `--force` upgrade
  without a full regression pass.
- **No source maps** are uploaded, so stack traces in Sentry are minified.
