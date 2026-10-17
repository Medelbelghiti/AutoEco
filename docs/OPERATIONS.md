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
