# Scripts

Operational scripts. None of these touch production: every one that writes uses
the local database you point it at, and the two HTTP tests boot the **real
production build** (`next start`) on a local port.

| Script | npm alias | What it does |
| --- | --- | --- |
| `launch-check.mjs` | `check:launch` / `check:launch:db` | Static pre-flight: scans the tree for `[BRACKETED]` legal placeholders, missing required env, and obviously unlaunchable config. With `--db`, also checks the database. This is the live source of truth for blockers. |
| `build-with-migrate.js` | `build` | Wraps `next build` so a production build runs the migration step in the right order. |
| `prisma-migrate.mjs` | `prisma:migrate` / `prisma:deploy` | Thin wrapper around `prisma migrate dev|deploy` that loads the local env. |
| `seed-plans.ts` | — | Idempotent plans-only upsert (`free`, `pro`, `family`, `pro_plus`). Safe to run repeatedly; used as the setup step of the two tests below. |
| `smoke.mjs` | — | Black-box HTTP smoke test of the everyday user journeys + auth/security edges. |
| `paddle-dry-run.mjs` | — | Replays a full Paddle Billing lifecycle through the real webhook with locally signed fixtures. |

---

## `smoke.mjs` — local production smoke test

Boots `next start` (so you must run `npx next build` first) against a local
disposable Postgres, then drives the app over HTTP exactly as a browser would.

**Covers**

- Anonymous `/api/health`: responds, returns boolean checks, leaks no secret or
  DB connection string.
- Signup (captcha disabled locally) → session cookie set.
- Login: wrong password rejected `401`, correct password accepted.
- Vehicle, expense, trip creation.
- Receipt upload (multipart, PNG magic bytes) to local disk storage.
- PDF report entitlement: **free → 403**, **pro → 200 `application/pdf`**.
- Language switch (`PATCH /api/profile { locale }` persists).
- Sign out of all devices (`303` + cookie cleared, old cookie now `401`),
  re-login, then logout (`303` + clearing `Set-Cookie`).
- Paddle webhook: forged signature rejected `400`; a signed
  `transaction.completed` accepted `200` and an exact replay is idempotent
  (the invoice is not duplicated).
- Cron routes fail closed (`401`) without the secret and with a wrong secret.

**Run**

```powershell
npx next build
node scripts/smoke.mjs
```

**Env (all optional; local defaults shown)**

| Var | Default | Notes |
| --- | --- | --- |
| `SMOKE_PORT` | `3199` | Port for the temporary server. |
| `SMOKE_DATABASE_URL` | `postgresql://autoeco:autoeco@127.0.0.1:5432/autoeco_test` | Must be a **local disposable** database. The script sets `AUTH_SECRET`, `CRON_SECRET` and fake Paddle values itself. |

Every user it creates is deleted before it exits. Exits non-zero if any check
fails, and prints a `PASS`/`FAIL` line per assertion.

---

## `paddle-dry-run.mjs` — Paddle webhook lifecycle dry-run

Replays a realistic Paddle Billing lifecycle against the **real** webhook route
using HMAC-SHA256 signatures computed locally. No Paddle account and no call to
Paddle are needed: the server verifies the same secret the script signs with.

**Sequence** (each step prints the resulting `Subscription` / `Invoice` / plan
state read straight from the database — those rows are the entitlement source of
truth):

1. `subscription.created` → plan becomes `pro`, subscription `active`.
2. `transaction.completed` `"699"` USD → invoice `paid`, amount `699` cents
   (proves minor units are not multiplied by 100).
3. Replay of the transaction (`subscription.updated`/transaction) → idempotent,
   invoice not duplicated.
4. `subscription.past_due` → status `past_due` (grace applies).
5. `subscription.resumed` → `active` again.
6. `adjustment.created` **partial** refund → invoice `partially_refunded`,
   access kept.
7. `adjustment.created` **full** refund of the latest transaction → invoice
   `refunded`; an immediate Paddle cancel is attempted (with a fake API key it
   fails safely and is audited — the webhook still returns `200`).
8. `subscription.canceled` → subscription `canceled`, user downgraded to `free`.
9. Out-of-order replay: an older `subscription.updated` cannot resurrect the
   canceled subscription, and an exact replay of the cancel is skipped.
10. Unknown price id (`subscription.created` with a price not in our catalog) →
    no entitlement is granted; it is recorded in the audit log only.

**Run**

```powershell
npx next build
node scripts/paddle-dry-run.mjs
```

**Env (all optional; local defaults shown)**

| Var | Default | Notes |
| --- | --- | --- |
| `PADDLE_DRY_RUN_BASE` | — | Point at an already-running server instead of booting one. |
| `SMOKE_DATABASE_URL` / `DATABASE_URL` | local `autoeco_test` | Must be a **local disposable** database. |
| `PADDLE_DRY_RUN_PORT` | `3200` | Port used when it boots its own server. |

The fake Paddle API key is deliberately **not** a `pdl_` key, so the production
boot audit accepts it and `cancelPaddleSubscription` cannot reach a real
account. The created user is deleted at the end. Exits non-zero on any
unexpected webhook response.

> Both scripts boot `next start`, which refuses to run without a build. Run
> `npx next build` first. They are intentionally not wired into CI (CI has no
> browser and no persistent local disk); they are a pre-release / post-deploy
> rehearsal you run by hand against the local build.
