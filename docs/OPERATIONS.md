# Operations

Operational notes for running AutoEco in production.

## `GET /api/health`

Liveness + configuration readiness probe. Safe to hit from uptime monitors.

- **Healthy** (database reachable and schema matches the code): `200`.
- **Unhealthy** (database unreachable, or a required `information_schema`
  column is missing): `503`.
- **Degraded** (email transport, Paddle credentials, cron secret, storage not
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

## PayPal — one-time "Founder Lifetime"

A single one-time purchase that grants **lifetime** access with the **same
limits and monthly quotas as the Pro plan**. It is billed by PayPal, NOT by
Paddle (Paddle stays the subscription provider and is untouched by this
feature).

### Configuration (server side only)

| Variable | Meaning |
| --- | --- |
| `BILLING_ENABLED` | Feature flag. **Default `false`.** Only `"true"` enables it. |
| `PAYPAL_ENV` | `"sandbox"` (default) or `"live"`. |
| `PAYPAL_CLIENT_ID` | Public app client id (sent to the browser). |
| `PAYPAL_CLIENT_SECRET` | **Secret.** Never logged, never sent to the client. |
| `PAYPAL_WEBHOOK_ID` | Webhook id used to verify signatures. |
| `LIFETIME_PRICE_MINOR` | Price in minor units (`9900` = USD 99.00). |
| `LIFETIME_CURRENCY` | ISO 4217 code (`USD`). |
| `LIFETIME_MAX_GRANTS` | Grant cap. The **code default is `0` = disabled**; the configured cap is supplied here. |

**Fail closed.** If billing is disabled OR any PayPal credential, the price or
the currency is missing, the feature is OFF: no endpoint creates an order, no
button is rendered and the webhook returns 503. There is no partial mode.

### Webhook

- URL: `https://<domain>/api/paypal/webhook`
- Subscribed events: `PAYMENT.CAPTURE.COMPLETED`,
  `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`,
  `PAYMENT.CAPTURE.DENIED`.
- The signature is verified through PayPal's own
  `POST /v1/notifications/verify-webhook-signature` and **fails closed**.
- Delivery is de-duplicated by event id through the shared `WebhookEvent`
  state machine, and every grant/refund is applied through a conditional claim
  on the stored `PaymentOrder`, so replays and out-of-order deliveries are
  idempotent. Unknown orders/users are audited and answered `200`.

### Entitlement & refund rules

- Access is granted ONLY by a verified event (or a server-side re-check in the
  capture endpoint), never by a client claim.
- Grants are capped at `LIFETIME_MAX_GRANTS`; the cap is enforced under a row
  lock so two concurrent captures cannot both take the last slot.
- A **full** refund (or a reversal) revokes lifetime access and drops the user
  to Free when nothing else is active. A **partial** refund keeps access and
  records the partial state and amount.
- No card data is ever read or stored — only PayPal's own order/capture ids,
  amounts and status.

### Turning it on (ordered)

1. Create a PayPal Business app; note the client id and secret.
2. In the app, add a webhook to `https://<domain>/api/paypal/webhook` with the
   four events above and copy its **Webhook ID**.
3. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
   `LIFETIME_PRICE_MINOR`, `LIFETIME_CURRENCY`, `LIFETIME_MAX_GRANTS` and
   `PAYPAL_ENV=sandbox` in the deployment environment.
4. Deploy, then run a **sandbox** purchase end to end.
5. Only when the sandbox round trip succeeds, set `BILLING_ENABLED="true"`.
6. Switch to `PAYPAL_ENV=live` with live credentials only when ready to take
   real money.
